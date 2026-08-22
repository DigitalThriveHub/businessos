import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { financeDashboardSchema, financeReadQuerySchema } from "@/lib/finance";
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

    const input = financeReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(input.organisationId)}/finance`,
      { method: "GET", accessToken },
    );
    return secureJson(financeDashboardSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "finance information");
  }
}
