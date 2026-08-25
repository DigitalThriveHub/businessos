/**
 * BusinessOS server-side API client.
 *
 * Security:
 * - This module must never run in the browser.
 * - Authentication tokens are supplied only by trusted server code.
 * - Tokens, credentials and API response bodies are never logged.
 * - The NestJS API remains responsible for RBAC and organisation isolation.
 */

import "server-only";

const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getApiBaseUrl(): string {
  const configuredUrl =
    process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;

  if (!configuredUrl) {
    throw new Error(
      "Missing API_URL or NEXT_PUBLIC_API_URL in the frontend environment.",
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error("The configured API URL is invalid.");
  }

  if (
    process.env.NODE_ENV === "production" &&
    parsedUrl.protocol !== "https:"
  ) {
    throw new Error("The production API URL must use HTTPS.");
  }

  return parsedUrl.toString().replace(/\/+$/, "");
}

export type ApiRequestOptions = Omit<RequestInit, "headers"> & {
  accessToken?: string;
  headers?: HeadersInit;
  timeoutMs?: number;
};

export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("API paths must be internal absolute paths.");
  }

  const {
    accessToken,
    headers: suppliedHeaders,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...requestOptions
  } = options;

  const headers = new Headers(suppliedHeaders);

  headers.set("Accept", "application/json");

  if (
    requestOptions.body &&
    !(requestOptions.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    timeoutMs,
  );

  try {
    const response = await fetch(
      `${getApiBaseUrl()}${path}`,
      {
        ...requestOptions,
        headers,
        signal: abortController.signal,
        cache: "no-store",
        redirect: "error",
      },
    );

    if (!response.ok) {
      let problem: {
        detail?: string;
        code?: string;
        correlationId?: string;
      } = {};
      if (response.headers.get("content-type")?.includes("json")) {
        try {
          problem = (await response.json()) as typeof problem;
        } catch {
          // An invalid upstream error body is replaced with the safe fallback.
        }
      }
      const safeMessages: Record<number, string> = {
        400: "The submitted information is invalid.",
        401: "Authentication is required.",
        403: "You do not have permission to perform this action.",
        404: "The requested resource was not found.",
        409: "The requested operation conflicts with an existing record.",
        429: "Too many requests. Please try again shortly.",
        503: "The provider service is temporarily unavailable.",
      };
      const detail =
        typeof problem.detail === "string" && problem.detail.length <= 1000
          ? problem.detail
          : safeMessages[response.status] ??
            "The API request could not be completed.";
      throw new ApiError(
        response.status >= 500
          ? safeMessages[response.status] ??
              "The API request could not be completed."
          : detail,
        response.status,
        typeof problem.code === "string" ? problem.code : undefined,
        typeof problem.correlationId === "string"
          ? problem.correlationId
          : response.headers.get("x-correlation-id") ?? undefined,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type");

    if (!contentType?.includes("application/json")) {
      throw new ApiError(
        "The API returned an invalid response.",
        502,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new ApiError(
        "The API request timed out.",
        504,
      );
    }

    throw new ApiError(
      "The secure API service is unavailable.",
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}
