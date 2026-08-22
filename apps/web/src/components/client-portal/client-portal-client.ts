"use client";

import type { ZodType } from "zod";

import { createClient } from "@/lib/supabase/client";

const REQUEST_TIMEOUT_MS = 25_000;

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // Detailed upstream errors are intentionally not exposed.
  }
  if (response.status === 401) return "Please sign in again to continue.";
  if (response.status === 403) return "This portal item is not authorised for your account.";
  if (response.status === 404) return "This portal item is no longer available.";
  if (response.status === 409) return "This portal item changed. Refresh and try again.";
  return "The secure client portal request could not be completed.";
}

export async function clientPortalRequest<T>(
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

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function uploadPortalDocument(input: {
  bucket: string;
  path: string;
  file: File;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(input.bucket).upload(
    input.path,
    input.file,
    {
      cacheControl: "3600",
      contentType: input.file.type.toLowerCase(),
      upsert: false,
    },
  );
  if (error) throw new Error("The file could not be uploaded to the secure vault.");
}

export async function downloadPortalDocument(input: {
  bucket: string;
  path: string;
  fileName: string;
}): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(input.bucket).download(input.path);
  if (error || !data) throw new Error("This document is unavailable to your secure session.");

  const objectUrl = URL.createObjectURL(data);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = input.fileName.replace(/[\\/\u0000-\u001f\u007f]/g, "_");
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}
