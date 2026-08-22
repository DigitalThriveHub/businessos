import type { ZodType } from "zod";

const REQUEST_TIMEOUT_MS = 15_000;

type ErrorBody = {
  message?: string;
};

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody;
    if (body.message) return body.message;
  } catch {
    // Upstream response details are deliberately not exposed.
  }

  if (response.status === 401) {
    return "Your secure session has expired. Please sign in again.";
  }
  if (response.status === 403) {
    return "Your role does not permit this operation, or MFA is required.";
  }
  if (response.status === 404) {
    return "The requested record is no longer available.";
  }
  if (response.status === 409) {
    return "The record changed or conflicts with an existing record. Refresh and retry.";
  }

  return "The operation could not be completed. Please try again.";
}

export async function caseManagementRequest<T>(
  url: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = window.setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await responseMessage(response));
    }

    return schema.parse(await response.json());
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new Error("The secure request timed out. Please try again.");
    }

    throw error instanceof Error
      ? error
      : new Error("The secure request could not be completed.");
  } finally {
    window.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function isoOrNull(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function dateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
