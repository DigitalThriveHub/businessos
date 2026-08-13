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
      if (response.status === 400) {
        throw new ApiError(
          "The submitted information is invalid.",
          400,
        );
      }

      if (response.status === 401) {
        throw new ApiError(
          "Authentication is required.",
          401,
        );
      }

      if (response.status === 403) {
        throw new ApiError(
          "You do not have permission to perform this action.",
          403,
        );
      }

      if (response.status === 404) {
        throw new ApiError(
          "The requested resource was not found.",
          404,
        );
      }

      if (response.status === 409) {
        throw new ApiError(
          "The requested operation conflicts with an existing record.",
          409,
        );
      }

      throw new ApiError(
        "The API request could not be completed.",
        response.status,
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