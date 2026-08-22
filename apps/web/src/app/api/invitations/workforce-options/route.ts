import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  invitationWorkforceOptionsQuerySchema,
  invitationWorkforceOptionsSchema,
} from "@/lib/invitations";
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

    const { organisationId } = invitationWorkforceOptionsQuerySchema.parse({
      organisationId: request.nextUrl.searchParams.get("organisationId"),
    });

    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        organisationId,
      )}/invitations/workforce-options`,
      {
        method: "GET",
        accessToken,
      },
    );

    return secureJson(invitationWorkforceOptionsSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "workforce configuration");
  }
}