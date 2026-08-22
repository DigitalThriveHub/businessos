import { DocumentScannerConfig } from './document-scanner.config';
import { SupabasePrivateStorageService } from './supabase-storage.service';

describe('SupabasePrivateStorageService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function service(): SupabasePrivateStorageService {
    return new SupabasePrivateStorageService(
      new DocumentScannerConfig({
        DOCUMENT_SCANNER_ENABLED: 'true',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-that-is-long-enough',
        CLAMAV_HOST: 'clamav.internal',
      }),
    );
  }

  it('downloads only the encoded private object with backend credentials', async () => {
    const chunks = (async function* () {
      yield new Uint8Array([1, 2, 3]);
    })();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: chunks,
      headers: new Headers({
        'content-length': '3',
        'content-type': 'application/pdf',
      }),
    });

    const download = await service().download(
      'businessos-documents',
      'organisation/matter/a file.pdf',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.supabase.co/storage/v1/object/authenticated/businessos-documents/organisation/matter/a%20file.pdf',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        headers: expect.objectContaining({
          apikey: 'test-service-role-key-that-is-long-enough',
          Authorization: 'Bearer test-service-role-key-that-is-long-enough',
          'Accept-Encoding': 'identity',
        }),
      }),
    );
    expect(download.contentLength).toBe(3);
    expect(download.contentType).toBe('application/pdf');
    download.cancel();
  });

  it('rejects traversal paths before contacting storage', async () => {
    global.fetch = jest.fn();

    await expect(
      service().download('businessos-documents', 'organisation/../secret.pdf'),
    ).rejects.toMatchObject({ code: 'STORAGE_PATH_INVALID', retryable: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('classifies a storage outage as retryable without leaking its response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
      headers: new Headers(),
    });

    await expect(
      service().download('businessos-documents', 'organisation/file.pdf'),
    ).rejects.toMatchObject({ code: 'STORAGE_HTTP_503', retryable: true });
  });
});