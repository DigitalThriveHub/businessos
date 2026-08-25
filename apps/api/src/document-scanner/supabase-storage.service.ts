import { Injectable } from '@nestjs/common';

import { DocumentScannerConfig } from './document-scanner.config';
import { ScannerPipelineError } from './document-scanner.types';

export interface PrivateStorageDownload {
  chunks: AsyncIterable<Uint8Array>;
  contentLength: number | null;
  contentType: string | null;
  cancel: () => void;
}

function encodeStoragePath(value: string): string {
  const segments = value.split('/');
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new ScannerPipelineError(
      'STORAGE_PATH_INVALID',
      'The registered storage path is invalid.',
      false,
    );
  }
  return segments.map(encodeURIComponent).join('/');
}

@Injectable()
export class SupabasePrivateStorageService {
  constructor(private readonly config: DocumentScannerConfig) {}

  async download(
    bucket: string,
    path: string,
  ): Promise<PrivateStorageDownload> {
    this.config.assertEnabled();
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(bucket)) {
      throw new ScannerPipelineError(
        'STORAGE_BUCKET_INVALID',
        'The registered storage bucket is invalid.',
        false,
      );
    }

    const encodedPath = encodeStoragePath(path);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.storageTimeoutMs,
    );
    let response: Response;
    try {
      response = await fetch(
        `${this.config.supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(
          bucket,
        )}/${encodedPath}`,
        {
          method: 'GET',
          headers: {
            apikey: this.config.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
            Accept: 'application/octet-stream',
            'Accept-Encoding': 'identity',
          },
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        },
      );
    } catch (error) {
      clearTimeout(timeout);
      throw new ScannerPipelineError(
        'STORAGE_UNAVAILABLE',
        'The private storage object could not be retrieved.',
        true,
        { cause: error },
      );
    }

    if (!response.ok || !response.body) {
      clearTimeout(timeout);
      controller.abort();
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      throw new ScannerPipelineError(
        `STORAGE_HTTP_${response.status}`,
        'The private storage object could not be retrieved.',
        retryable,
      );
    }

    const lengthHeader = response.headers.get('content-length');
    const contentLength = lengthHeader === null ? null : Number(lengthHeader);
    if (
      contentLength !== null &&
      (!Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        contentLength > this.config.maxFileBytes)
    ) {
      clearTimeout(timeout);
      controller.abort();
      throw new ScannerPipelineError(
        'STORAGE_SIZE_INVALID',
        'The stored object exceeds the approved scanner size.',
        false,
      );
    }

    const body = response.body as unknown as AsyncIterable<Uint8Array>;
    return {
      chunks: body,
      contentLength,
      contentType: response.headers.get('content-type'),
      cancel: () => {
        clearTimeout(timeout);
        controller.abort();
      },
    };
  }
}
