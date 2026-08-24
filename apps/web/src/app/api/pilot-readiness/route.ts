import type { NextRequest } from "next/server";
import { apiFetch } from "@/lib/api";
import { pilotReadinessQuerySchema, pilotReadinessSchema } from "@/lib/pilot-readiness";
import { authenticationRequiredResponse, bffErrorResponse, getVerifiedAccessToken, secureJson } from "@/lib/security/bff-route";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();
    const input = pilotReadinessQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const result = await apiFetch(`/api/v1/organisations/${encodeURIComponent(input.organisationId)}/pilot-readiness`, { method: "GET", accessToken });
    return secureJson(pilotReadinessSchema.parse(result));
  } catch (error) { return bffErrorResponse(error, "pilot-readiness information"); }
}
