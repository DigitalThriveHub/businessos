import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  type CommunicationsMutation,
  communicationsMutationSchema,
  genericMutationResultSchema,
} from "@/lib/communications";
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
};

function upstreamMutation(input: CommunicationsMutation): UpstreamMutation {
  const base = `/api/v1/organisations/${encodeURIComponent(
    input.organisationId,
  )}/communications`;

  switch (input.operation) {
    case "conversation.create":
      return {
        path: `${base}/conversations`,
        body: input.payload,
        created: true,
      };
    case "message.send":
      return {
        path: `${base}/conversations/${encodeURIComponent(
          input.conversationId,
        )}/messages`,
        body: input.payload,
        created: true,
      };
    case "template.create":
      return { path: `${base}/templates`, body: input.payload, created: true };
    case "invitation.create":
      return {
        path: `${base}/portal-invitations`,
        body: input.payload,
        created: true,
      };
    case "invitation.revoke":
      return {
        path: `${base}/portal-invitations/${encodeURIComponent(
          input.invitationId,
        )}/revoke`,
        body: input.payload,
        created: false,
      };
    case "access.revoke":
      return {
        path: `${base}/portal-access/${encodeURIComponent(
          input.accessGrantId,
        )}/revoke`,
        body: input.payload,
        created: false,
      };
    case "portal-update.publish":
      return {
        path: `${base}/portal-updates`,
        body: input.payload,
        created: true,
      };
    case "reminder.schedule":
      return { path: `${base}/reminders`, body: input.payload, created: true };
    case "reminder.cancel":
      return {
        path: `${base}/reminders/${encodeURIComponent(
          input.reminderId,
        )}/cancel`,
        body: input.payload,
        created: false,
      };
    case "matching.resolve":
      return {
        path: `${base}/matching/${encodeURIComponent(input.queueId)}/decision`,
        body: input.payload,
        created: false,
      };
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();

    const input = communicationsMutationSchema.parse(
      await readSameOriginJson(request, 60_000),
    );
    const upstream = upstreamMutation(input);
    const response = await apiFetch<unknown>(upstream.path, {
      method: "POST",
      accessToken,
      body: JSON.stringify(upstream.body),
    });

    return secureJson(
      genericMutationResultSchema.parse(response),
      upstream.created ? 201 : 200,
    );
  } catch (error) {
    return bffErrorResponse(error, "communication change");
  }
}
