import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  operationalIntelligenceDashboardSchema,
  operationalIntelligenceReadQuerySchema,
} from "@/lib/operational-intelligence";
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
    const input = operationalIntelligenceReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        input.organisationId,
      )}/operational-intelligence`,
      { method: "GET", accessToken, timeoutMs: 20_000 },
    );
    return secureJson(operationalIntelligenceDashboardSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "operational-intelligence information");
  }
}
