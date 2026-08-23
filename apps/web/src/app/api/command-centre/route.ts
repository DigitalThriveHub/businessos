import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  commandCentreDashboardSchema,
  commandCentreReadQuerySchema,
} from "@/lib/command-centre";
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

    const input = commandCentreReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        input.organisationId,
      )}/command-centre`,
      { method: "GET", accessToken },
    );

    return secureJson(commandCentreDashboardSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "command-centre information");
  }
}
