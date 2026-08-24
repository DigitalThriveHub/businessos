import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  integrationsDashboardSchema,
  gateHDashboardSchema,
  integrationsReadQuerySchema,
} from "@/lib/integrations";
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

    const input = integrationsReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        input.organisationId,
      )}/integrations${input.view === "gate-h" ? "/gate-h" : ""}`,
      { method: "GET", accessToken },
    );

    return secureJson(
      input.view === "gate-h"
        ? gateHDashboardSchema.parse(response)
        : integrationsDashboardSchema.parse(response),
    );
  } catch (error) {
    return bffErrorResponse(error, "integration information");
  }
}
