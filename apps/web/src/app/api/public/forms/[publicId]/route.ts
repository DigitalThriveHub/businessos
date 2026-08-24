import type { NextRequest } from "next/server";

import { ApiError, apiFetch } from "@/lib/api";
import { secureJson } from "@/lib/security/bff-route";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  try {
    const result = await apiFetch(
      `/api/v1/public/intake/forms/${encodeURIComponent(publicId)}`,
      {
        headers: request.headers.get("origin")
          ? { Origin: request.headers.get("origin")! }
          : undefined,
      },
    );
    return secureJson(result, 200);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return secureJson(
      {
        message:
          status === 404
            ? "The form is unavailable."
            : "The form could not be loaded.",
      },
      status,
    );
  }
}
