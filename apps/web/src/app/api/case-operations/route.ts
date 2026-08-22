import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  caseOperationsReadQuerySchema,
  matterOperationsSchema,
} from "@/lib/case-operations";
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

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const input = caseOperationsReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    const path = `/api/v1/organisations/${encodeURIComponent(
      input.organisationId,
    )}/matters/${encodeURIComponent(input.matterId)}/operations`;

    const response = await apiFetch<unknown>(path, {
      method: "GET",
      accessToken,
    });

    return secureJson(matterOperationsSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "case-operation information");
  }
}