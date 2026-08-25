import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  complianceAssuranceDashboardSchema,
  complianceAssuranceReadQuerySchema,
  dataSubjectExportCandidateSchema,
} from "@/lib/compliance-assurance";
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
    const input = complianceAssuranceReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const basePath = `/api/v1/organisations/${encodeURIComponent(
      input.organisationId,
    )}/compliance-assurance`;
    if (input.requestId) {
      const result = await apiFetch<unknown>(
        `${basePath}/rights/${encodeURIComponent(input.requestId)}/export-candidate`,
        { method: "GET", accessToken, timeoutMs: 30_000 },
      );
      return secureJson(dataSubjectExportCandidateSchema.parse(result));
    }
    const result = await apiFetch<unknown>(basePath, {
      method: "GET",
      accessToken,
      timeoutMs: 20_000,
    });
    return secureJson(complianceAssuranceDashboardSchema.parse(result));
  } catch (error) {
    return bffErrorResponse(error, "compliance-assurance information");
  }
}
