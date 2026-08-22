"use client";

import type { ZodType } from "zod";

const REQUEST_TIMEOUT_MS = 20_000;

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // Upstream and validation details remain private.
  }

  if (response.status === 401) return "Your secure session has expired.";
  if (response.status === 403) {
    return "Your role does not permit this operation, or MFA is required.";
  }
  if (response.status === 404) return "The operations record is unavailable.";
  if (response.status === 409) {
    return "This record changed. Refresh the operations workspace and retry.";
  }
  if (response.status === 429) return "Too many requests. Try again shortly.";
  return "The operations-control request could not be completed.";
}

export async function automationControlRequest<T>(
  url: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

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

    if (!response.ok) throw new Error(await responseMessage(response));
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
