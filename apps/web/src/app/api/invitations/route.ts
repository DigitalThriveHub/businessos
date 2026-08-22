import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  createInvitationRequestSchema,
  invitationListSchema,
  invitationQuerySchema,
  invitationSchema,
} from "@/lib/invitations";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  readSameOriginJson,
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

    const input =
      invitationQuerySchema.parse({
        organisationId:
          request.nextUrl.searchParams.get(
            "organisationId",
          ),
        page:
          request.nextUrl.searchParams.get(
            "page",
          ) ?? undefined,
        limit:
          request.nextUrl.searchParams.get(
            "limit",
          ) ?? undefined,
      });

    const query = new URLSearchParams({
      page: String(input.page),
      limit: String(input.limit),
    });

    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        input.organisationId,
      )}/invitations?${query.toString()}`,
      {
        method: "GET",
        accessToken,
      },
    );

    return secureJson(
      invitationListSchema.parse(response),
    );
  } catch (error) {
    return bffErrorResponse(
      error,
      "invitation",
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  try {
    const accessToken =
      await getVerifiedAccessToken();

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const input =
      createInvitationRequestSchema.parse(
        await readSameOriginJson(request),
      );

    const {
      organisationId,
      ...invitationInput
    } = input;

    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        organisationId,
      )}/invitations`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify(
          invitationInput,
        ),
      },
    );

    return secureJson(
      invitationSchema.parse(response),
      201,
    );
  } catch (error) {
    return bffErrorResponse(
      error,
      "invitation",
    );
  }
}