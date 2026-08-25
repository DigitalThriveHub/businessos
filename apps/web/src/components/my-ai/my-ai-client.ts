"use client";

import type { ZodType } from "zod";

const REQUEST_TIMEOUT_MS = 50_000;

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // Provider, database and validation details stay server-side.
  }

  if (response.status === 401) return "Your secure session has expired.";
  if (response.status === 403) {
    return "Your role does not permit this AI operation, or MFA is required.";
  }
  if (response.status === 404) return "The AI conversation is unavailable.";
  if (response.status === 409) {
    return "The conversation changed. Refresh the workspace and try again.";
  }
  if (response.status === 429) return "Too many requests. Try again shortly.";
  if ([502, 503, 504].includes(response.status)) {
    return "The governed AI provider is temporarily unavailable. No action was taken.";
  }
  return "The personal AI request could not be completed.";
}

export async function myAiRequest<T>(
  url: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
      throw new Error(
        "The AI request timed out. No action was taken; please try again.",
      );
    }
    throw error instanceof Error
      ? error
      : new Error("The personal AI request could not be completed.");
  } finally {
    window.clearTimeout(timeout);
  }
}
