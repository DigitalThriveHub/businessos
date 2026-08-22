import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  assignableInvitationRoleListSchema,
  invitationRoleQuerySchema,
} from "@/lib/invitations";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
) {
  try {
    const accessToken =
      await getVerifiedAccessToken();

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const { organisationId } =
      invitationRoleQuerySchema.parse({
        organisationId:
          request.nextUrl.searchParams.get(
            "organisationId",
          ),
      });

    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        organisationId,
      )}/invitations/assignable-roles`,
      {
        method: "GET",
        accessToken,
      },
    );

    return secureJson(
      assignableInvitationRoleListSchema.parse(
        response,
      ),
    );
  } catch (error) {
    return bffErrorResponse(
      error,
      "role catalogue",
    );
  }
}