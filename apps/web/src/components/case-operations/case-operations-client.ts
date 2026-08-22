"use client";

import type { ZodType } from "zod";

import type { DocumentUploadRegistration } from "@/lib/case-operations";
import { createClient } from "@/lib/supabase/client";

const REQUEST_TIMEOUT_MS = 20_000;

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // Upstream details remain private.
  }

  if (response.status === 401) return "Your secure session has expired.";
  if (response.status === 403) {
    return "Your role does not permit this operation, or MFA is required.";
  }
  if (response.status === 404) return "The case record is no longer available.";
  if (response.status === 409) {
    return "The record changed. Refresh this matter and try again.";
  }
  return "The case operation could not be completed.";
}

export async function caseOperationsRequest<T>(
  url: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

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
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(await responseMessage(response));
    return schema.parse(await response.json());
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new Error("The secure request timed out. Please try again.");
    }
    throw error instanceof Error
      ? error
      : new Error("The secure request could not be completed.");
  } finally {
    window.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function uploadPrivateDocument(
  registration: DocumentUploadRegistration,
  file: File,
): Promise<void> {
  if (
    file.size !== registration.expectedSizeBytes ||
    file.type.toLowerCase() !== registration.expectedContentType
  ) {
    throw new Error("The selected file changed after secure registration.");
  }

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(registration.storageBucket)
    .upload(registration.storagePath, file, {
      cacheControl: "3600",
      contentType: registration.expectedContentType,
      upsert: false,
    });

  if (error) {
    throw new Error("The file could not be uploaded to the private vault.");
  }
}

export async function downloadPrivateDocument(input: {
  bucket: string;
  path: string;
  fileName: string;
}): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(input.bucket)
    .download(input.path);

  if (error || !data) {
    throw new Error("This document is not available to your current secure session.");
  }

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

export function isoOrNull(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}