import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  communicationsDashboardSchema,
  communicationsReadQuerySchema,
} from "@/lib/communications";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();

    const input = communicationsReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const base = `/api/v1/organisations/${encodeURIComponent(
      input.organisationId,
    )}/communications`;
    const [response, liveOperations] = await Promise.all([
      apiFetch<unknown>(base, { method: "GET", accessToken }),
      apiFetch<unknown>(`${base}/live-operations`, {
        method: "GET",
        accessToken,
      }),
    ]);

    return secureJson(
      communicationsDashboardSchema.parse({
        ...(typeof response === "object" && response !== null ? response : {}),
        liveOperations,
      }),
    );
  } catch (error) {
    return bffErrorResponse(error, "communications information");
  }
}
