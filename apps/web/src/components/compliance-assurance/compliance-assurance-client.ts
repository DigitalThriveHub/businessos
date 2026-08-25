import type { z } from "zod";

type ErrorBody = { message?: unknown };

function safeMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string");
    return typeof first === "string" ? first : null;
  }
  return null;
}

export async function complianceRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The status-specific fallback below is safer than exposing provider text.
  }
  if (!response.ok) {
    const message = safeMessage((body as ErrorBody | null)?.message);
    if (response.status === 401)
      throw new Error("Your session has expired. Sign in again.");
    if (response.status === 403)
      throw new Error(
        "AAL2 or additional authority is required for this action.",
      );
    if (response.status === 409)
      throw new Error(
        message ?? "This record changed. Refresh before retrying.",
      );
    if (response.status === 429)
      throw new Error("Too many requests. Wait briefly before retrying.");
    throw new Error(
      message ?? "The assurance service is temporarily unavailable.",
    );
  }
  return schema.parse(body);
}
