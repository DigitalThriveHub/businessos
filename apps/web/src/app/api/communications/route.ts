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
    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        input.organisationId,
      )}/communications`,
      { method: "GET", accessToken },
    );

    return secureJson(communicationsDashboardSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "communications information");
  }
}
