import { createHash } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

import { Injectable } from '@nestjs/common';

import { DocumentScannerConfig } from './document-scanner.config';
import {
  ScannerPipelineError,
  type ScannerVerdict,
} from './document-scanner.types';

const RESPONSE_LIMIT_BYTES = 8_192;

function write(socket: Socket, value: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(value, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function readResponse(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;

    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
      socket.off('end', onEnd);
    };
    const finish = () => {
      cleanup();
      const response = Buffer.concat(chunks).toString('utf8').replace(/[\0\r\n]+$/g, '').trim();
      if (!response) {
        reject(new ScannerPipelineError('CLAMAV_EMPTY_RESPONSE', 'ClamAV returned no verdict.', true));
        return;
      }
      resolve(response);
    };
    const onData = (chunk: Buffer) => {
      length += chunk.length;
      if (length > RESPONSE_LIMIT_BYTES) {
        cleanup();
        reject(new ScannerPipelineError('CLAMAV_RESPONSE_TOO_LARGE', 'ClamAV returned an invalid response.', false));
        return;
      }
      chunks.push(chunk);
      if (chunk.includes(0) || chunk.includes(10)) finish();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new ScannerPipelineError('CLAMAV_CONNECTION_ERROR', 'ClamAV connection failed.', true, { cause: error }));
    };
    const onTimeout = () => {
      cleanup();
      reject(new ScannerPipelineError('CLAMAV_TIMEOUT', 'ClamAV did not return a verdict in time.', true));
    };
    const onEnd = () => {
      if (chunks.length > 0) finish();
      else onError(new Error('ClamAV closed the connection.'));
    };

    socket.setTimeout(timeoutMs);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    socket.once('end', onEnd);
  });
}

@Injectable()
export class ClamAvClientService {
  private cachedVersion: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: DocumentScannerConfig) {}

  async scan(
    chunks: AsyncIterable<Uint8Array>,
    expectedSizeBytes: number,
  ): Promise<ScannerVerdict> {
    this.config.assertEnabled();
    if (
      !Number.isSafeInteger(expectedSizeBytes) ||
      expectedSizeBytes < 1 ||
      expectedSizeBytes > this.config.maxFileBytes
    ) {
      throw new ScannerPipelineError(
        'REGISTERED_SIZE_INVALID',
        'The registered document size cannot be scanned.',
        false,
      );
    }

    const engineVersion = await this.version();
    const socket = await this.connect();
    const responsePromise = readResponse(socket, this.config.scanTimeoutMs);
    const hash = createHash('sha256');
    let observedSizeBytes = 0;

    try {
      await write(socket, Buffer.from('zINSTREAM\0', 'utf8'));
      for await (const value of chunks) {
        const chunk = Buffer.from(value);
        if (chunk.length === 0) continue;
        observedSizeBytes += chunk.length;
        if (observedSizeBytes > this.config.maxFileBytes) {
          throw new ScannerPipelineError(
            'STREAM_SIZE_LIMIT_EXCEEDED',
            'The document exceeded the approved scanner size.',
            false,
          );
        }
        hash.update(chunk);
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length, 0);
        await write(socket, length);
        await write(socket, chunk);
      }
      await write(socket, Buffer.alloc(4));

      const response = await responsePromise;
      const observedSha256Hex = hash.digest('hex');
      if (observedSizeBytes !== expectedSizeBytes) {
        throw new ScannerPipelineError(
          'STORAGE_SIZE_MISMATCH',
          'The downloaded object size does not match its registered size.',
          false,
        );
      }

      if (/^stream:\s+OK$/i.test(response)) {
        return {
          result: 'CLEAN',
          observedSha256Hex,
          observedSizeBytes,
          engineVersion,
          signature: null,
        };
      }

      const infected = /^stream:\s+(.+)\s+FOUND$/i.exec(response);
      if (infected?.[1]) {
        return {
          result: 'INFECTED',
          observedSha256Hex,
          observedSizeBytes,
          engineVersion,
          signature: infected[1].slice(0, 240),
        };
      }

      throw new ScannerPipelineError(
        'CLAMAV_PROTOCOL_ERROR',
        'ClamAV returned an unrecognised verdict.',
        !/size limit exceeded/i.test(response),
      );
    } catch (error) {
      socket.destroy();
      await responsePromise.catch(() => undefined);
      if (error instanceof ScannerPipelineError) throw error;
      throw new ScannerPipelineError(
        'CLAMAV_STREAM_ERROR',
        'The document stream could not be scanned.',
        true,
        { cause: error },
      );
    } finally {
      socket.destroy();
    }
  }

  private async version(): Promise<string> {
    const now = Date.now();
    if (this.cachedVersion && this.cachedVersion.expiresAt > now) {
      return this.cachedVersion.value;
    }
    const socket = await this.connect();
    const responsePromise = readResponse(socket, this.config.connectTimeoutMs);
    try {
      await write(socket, Buffer.from('zVERSION\0', 'utf8'));
      const value = (await responsePromise).slice(0, 240);
      this.cachedVersion = { value, expiresAt: now + 3_600_000 };
      return value;
    } catch (error) {
      await responsePromise.catch(() => undefined);
      if (error instanceof ScannerPipelineError) throw error;
      throw new ScannerPipelineError(
        'CLAMAV_VERSION_ERROR',
        'ClamAV version verification failed.',
        true,
        { cause: error },
      );
    } finally {
      socket.destroy();
    }
  }

  private connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = this.config.clamavSocketPath
        ? createConnection(this.config.clamavSocketPath)
        : createConnection({
            host: this.config.clamavHost!,
            port: this.config.clamavPort,
          });
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new ScannerPipelineError('CLAMAV_CONNECT_TIMEOUT', 'ClamAV connection timed out.', true));
      }, this.config.connectTimeoutMs);
      socket.once('connect', () => {
        clearTimeout(timeout);
        socket.off('error', onError);
        resolve(socket);
      });
      const onError = (error: Error) => {
        clearTimeout(timeout);
        socket.destroy();
        reject(new ScannerPipelineError('CLAMAV_CONNECT_FAILED', 'ClamAV is unavailable.', true, { cause: error }));
      };
      socket.once('error', onError);
    });
  }
}