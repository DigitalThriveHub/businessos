"use client";

import type { ZodType } from "zod";

export async function commandCentreRequest<T>(
  url: string,
  schema: ZodType<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      try {
        const body = JSON.parse(text) as { message?: string };
        if (body.message) throw new Error(body.message);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message !== "Unexpected end of JSON input"
        ) {
          throw error;
        }
      }
      throw new Error("The command centre could not be loaded.");
    }
    return schema.parse(JSON.parse(text));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The command-centre request timed out. Try again.");
    }
    throw error instanceof Error
      ? error
      : new Error("The command centre could not be loaded.");
  } finally {
    window.clearTimeout(timeout);
  }
}
