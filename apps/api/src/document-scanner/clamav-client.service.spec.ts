import { createHash } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import { ClamAvClientService } from './clamav-client.service';
import { DocumentScannerConfig } from './document-scanner.config';

function startClamAvStub(verdict: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket: Socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.includes(Buffer.from('zVERSION\0'))) {
          socket.end('ClamAV 1.4.3/test\0');
          return;
        }
        const commandLength = Buffer.byteLength('zINSTREAM\0');
        if (buffer.length < commandLength + 4) return;
        let offset = commandLength;
        while (offset + 4 <= buffer.length) {
          const size = buffer.readUInt32BE(offset);
          if (size === 0) {
            socket.end(`${verdict}\0`);
            return;
          }
          if (offset + 4 + size > buffer.length) return;
          offset += 4 + size;
        }
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Stub server did not bind to TCP.'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

describe('ClamAvClientService', () => {
  it('uses framed INSTREAM scanning and returns verified clean evidence', async () => {
    const { server, port } = await startClamAvStub('stream: OK');
    try {
      const config = new DocumentScannerConfig({
        DOCUMENT_SCANNER_ENABLED: 'true',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-that-is-long-enough',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: String(port),
      });
      const client = new ClamAvClientService(config);
      const content = Buffer.from('safe document');
      const verdict = await client.scan(
        (async function* () {
          yield content.subarray(0, 4);
          yield content.subarray(4);
        })(),
        content.length,
      );

      expect(verdict).toEqual({
        result: 'CLEAN',
        observedSha256Hex: createHash('sha256').update(content).digest('hex'),
        observedSizeBytes: content.length,
        engineVersion: 'ClamAV 1.4.3/test',
        signature: null,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('returns the bounded malware signature from an infected verdict', async () => {
    const { server, port } = await startClamAvStub('stream: Eicar-Test-Signature FOUND');
    try {
      const config = new DocumentScannerConfig({
        DOCUMENT_SCANNER_ENABLED: 'true',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-that-is-long-enough',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: String(port),
      });
      const client = new ClamAvClientService(config);
      const content = Buffer.from('test payload');
      const verdict = await client.scan(
        (async function* () {
          yield content;
        })(),
        content.length,
      );

      expect(verdict.result).toBe('INFECTED');
      expect(verdict.signature).toBe('Eicar-Test-Signature');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});