"use client";

import type { ZodType } from "zod";

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // The safe status-specific message below is used instead.
  }
  if (response.status === 401) return "Your secure session has expired.";
  if (response.status === 403)
    return "Your role does not permit this finance action, or MFA is required.";
  if (response.status === 404) return "The finance record is unavailable.";
  if (response.status === 409)
    return "This finance record changed. Refresh and try again.";
  return "The secure finance request could not be completed.";
}

export async function financeRequest<T>(
  url: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
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
        "The secure finance request timed out. Please try again.",
      );
    }
    throw error instanceof Error
      ? error
      : new Error("The secure finance request could not be completed.");
  } finally {
    window.clearTimeout(timeout);
  }
}
