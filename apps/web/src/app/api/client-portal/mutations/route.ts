import type { NextRequest } from "next/server";
import type { ZodType } from "zod";

import { apiFetch } from "@/lib/api";
import {
  type ClientPortalMutation,
  clientPortalMutationSchema,
  portalInvitationAcceptanceSchema,
  portalMessageResultSchema,
  portalNotificationReadSchema,
  portalUploadFinalisationSchema,
  portalUploadRegistrationSchema,
} from "@/lib/client-portal";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  readSameOriginJson,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

type UpstreamMutation = {
  path: string;
  body: unknown;
  created: boolean;
  schema: ZodType;
};

function upstreamMutation(input: ClientPortalMutation): UpstreamMutation {
  switch (input.operation) {
    case "invitation.accept":
      return {
        path: "/api/v1/client-portal/invitations/accept",
        body: input.payload,
        created: false,
        schema: portalInvitationAcceptanceSchema,
      };
    case "message.post":
      return {
        path: `/api/v1/client-portal/conversations/${encodeURIComponent(
          input.conversationId,
        )}/messages`,
        body: input.payload,
        created: true,
        schema: portalMessageResultSchema,
      };
    case "document.register":
      return {
        path: "/api/v1/client-portal/documents/uploads",
        body: input.payload,
        created: true,
        schema: portalUploadRegistrationSchema,
      };
    case "document.finalise":
      return {
        path: "/api/v1/client-portal/documents/finalise",
        body: input.payload,
        created: false,
        schema: portalUploadFinalisationSchema,
      };
    case "notification.read":
      return {
        path: `/api/v1/client-portal/notifications/${encodeURIComponent(
          input.notificationId,
        )}/read`,
        body: input.payload,
        created: false,
        schema: portalNotificationReadSchema,
      };
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();

    const input = clientPortalMutationSchema.parse(
      await readSameOriginJson(request, 60_000),
    );
    const upstream = upstreamMutation(input);
    const response = await apiFetch<unknown>(upstream.path, {
      method: "POST",
      accessToken,
      body: JSON.stringify(upstream.body),
    });

    return secureJson(
      upstream.schema.parse(response),
      upstream.created ? 201 : 200,
    );
  } catch (error) {
    return bffErrorResponse(error, "client portal change");
  }
}
