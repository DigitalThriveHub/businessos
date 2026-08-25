import { ProviderOperationError } from './provider.types';

const PROVIDER_TIMEOUT_MS = 20_000;

export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit,
  acceptedStatuses: readonly number[] = [200],
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  timer.unref();
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!acceptedStatuses.includes(response.status)) {
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      throw new ProviderOperationError(
        `${provider}_HTTP_${response.status}`,
        `${provider} rejected the operation.`,
        retryable,
        response.status,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderOperationError) throw error;
    throw new ProviderOperationError(
      `${provider}_UNAVAILABLE`,
      `${provider} could not be reached.`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson<T>(
  provider: string,
  response: Response,
): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderOperationError(
      `${provider}_INVALID_RESPONSE`,
      `${provider} returned an invalid response.`,
      true,
      response.status,
    );
  }
}

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 50_000);
}

export function safeProviderId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) {
    throw new ProviderOperationError(
      'PROVIDER_IDENTIFIER_INVALID',
      'The provider returned an unsupported message identifier.',
      false,
    );
  }
  return trimmed;
}
