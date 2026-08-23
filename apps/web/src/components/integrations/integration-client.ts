"use client";

import type { ZodType } from "zod";

export async function integrationRequest<T>(
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
    const text = await response.text();
    if (!response.ok) {
      let message = "The secure integration request could not be completed.";
      try {
        const body = JSON.parse(text) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        // Use the safe message above.
      }
      throw new Error(message);
    }
    return schema.parse(JSON.parse(text));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The integration request timed out. Try again.");
    }
    throw error instanceof Error
      ? error
      : new Error("The secure integration request could not be completed.");
  } finally {
    window.clearTimeout(timeout);
  }
}
