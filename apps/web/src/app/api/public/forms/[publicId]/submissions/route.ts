import type { NextRequest } from "next/server";

import { ApiError, apiFetch } from "@/lib/api";
import { secureJson } from "@/lib/security/bff-route";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  const body = await request.text();
  if (body.length < 2 || body.length > 65_536) {
    return secureJson({ message: "The form submission is invalid." }, 400);
  }
  try {
    const result = await apiFetch(
      `/api/v1/public/intake/forms/${encodeURIComponent(publicId)}/submissions`,
      {
        method: "POST",
        body,
        headers: request.headers.get("origin")
          ? { Origin: request.headers.get("origin")! }
          : undefined,
      },
    );
    return secureJson(result, 202);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return secureJson(
      {
        message:
          status === 409
            ? "The privacy notice changed. Reload and review the form."
            : "The submission could not be accepted.",
      },
      status,
    );
  }
}
