import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  workforceConfigurationQuerySchema,
  workforceConfigurationSnapshotSchema,
} from "@/lib/workforce-configuration";
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

    const { organisationId } = workforceConfigurationQuerySchema.parse({
      organisationId: request.nextUrl.searchParams.get("organisationId"),
    });

    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        organisationId,
      )}/workforce-configuration`,
      {
        method: "GET",
        accessToken,
      },
    );

    return secureJson(workforceConfigurationSnapshotSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "workforce configuration");
  }
}