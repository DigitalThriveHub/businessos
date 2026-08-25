"use client";

import type { ZodType } from "zod";

const REQUEST_TIMEOUT_MS = 20_000;

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      message?: string;
      correlationId?: string;
    };
    if (body.message) {
      return body.correlationId && !body.message.includes(body.correlationId)
        ? `${body.message} Support reference: ${body.correlationId}.`
        : body.message;
    }
  } catch {
    // Detailed upstream errors are intentionally not exposed.
  }

  if (response.status === 401) return "Your secure session has expired.";
  if (response.status === 403) return "Your role does not permit this action, or MFA is required.";
  if (response.status === 404) return "The communication record is unavailable.";
  if (response.status === 409) return "This record changed. Refresh and try again.";
  if (response.status === 429) return "Too many requests. Try again shortly.";
  return "The secure communications request could not be completed.";
}

export async function communicationsRequest<T>(
  url: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
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
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await responseMessage(response));
    return schema.parse(await response.json());
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The secure request timed out. Please try again.");
    }
    throw error instanceof Error
      ? error
      : new Error("The secure request could not be completed.");
  } finally {
    window.clearTimeout(timeoutId);
  }
}
