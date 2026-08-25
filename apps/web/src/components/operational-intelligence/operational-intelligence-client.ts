"use client";

import type { ZodType } from "zod";

export async function operationalIntelligenceRequest<T>(
  url: string,
  schema: ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let message: string | null = null;
      try {
        const body: unknown = JSON.parse(text);
        if (
          typeof body === "object" &&
          body !== null &&
          "message" in body &&
          typeof body.message === "string" &&
          body.message.length <= 500
        ) {
          message = body.message;
        }
      } catch {
        // The BFF returned a malformed error response; expose no raw content.
      }
      throw new Error(
        message ??
          "The operational-intelligence request could not be completed.",
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        "Operational intelligence returned an invalid response. No change was made.",
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        "Operational intelligence returned an invalid response. No change was made.",
      );
    }
    return parsed.data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The request timed out. No change was made; try again.");
    }
    throw error instanceof Error
      ? error
      : new Error("Operational intelligence is temporarily unavailable.");
  } finally {
    window.clearTimeout(timeout);
  }
}
