import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiFetch } from "@/lib/api";
import {
  invitationIdSchema,
  invitationRoleQuerySchema,
  invitationSchema,
  revokeInvitationRequestSchema,
} from "@/lib/invitations";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  readSameOriginJson,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const organisationQuerySchema =
  invitationRoleQuerySchema;

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const accessToken =
      await getVerifiedAccessToken();

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const parameters = z
      .object({
        id: invitationIdSchema,
      })
      .parse(await context.params);

    const { organisationId } =
      organisationQuerySchema.parse({
        organisationId:
          request.nextUrl.searchParams.get(
            "organisationId",
          ),
      });

    const input =
      revokeInvitationRequestSchema.parse(
        await readSameOriginJson(request),
      );

    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        organisationId,
      )}/invitations/${encodeURIComponent(
        parameters.id,
      )}/revoke`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify(input),
      },
    );

    return secureJson(
      invitationSchema.parse(response),
    );
  } catch (error) {
    return bffErrorResponse(
      error,
      "invitation",
    );
  }
}