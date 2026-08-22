import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  type AutomationControlMutation,
  approvalDecisionResultSchema,
  approvalSchema,
  automationControlMutationSchema,
  completedWorkItemSchema,
  slaPolicySchema,
} from "@/lib/automation-control";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  readSameOriginJson,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

type UpstreamMutation = {
  method: "POST" | "PATCH";
  path: string;
  body: unknown;
  created: boolean;
  parse: (value: unknown) => unknown;
};

function upstreamMutation(input: AutomationControlMutation): UpstreamMutation {
  const base = `/api/v1/organisations/${encodeURIComponent(
    input.organisationId,
  )}/automation-control`;

  switch (input.operation) {
    case "action.complete":
      return {
        method: "POST",
        path: `${base}/actions/${encodeURIComponent(input.actionId)}/complete`,
        body: input.payload,
        created: false,
        parse: (value) => completedWorkItemSchema.parse(value),
      };

    case "approval.create":
      return {
        method: "POST",
        path: `${base}/approvals`,
        body: input.payload,
        created: true,
        parse: (value) => approvalSchema.parse(value),
      };

    case "approval.decide":
      return {
        method: "POST",
        path: `${base}/approvals/${encodeURIComponent(
          input.approvalId,
        )}/decision`,
        body: input.payload,
        created: false,
        parse: (value) => approvalDecisionResultSchema.parse(value),
      };

    case "sla-policy.update":
      return {
        method: "PATCH",
        path: `${base}/sla-policies/${encodeURIComponent(input.policyId)}`,
        body: input.payload,
        created: false,
        parse: (value) => slaPolicySchema.parse(value),
      };
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const input = automationControlMutationSchema.parse(
      await readSameOriginJson(request),
    );
    const upstream = upstreamMutation(input);
    const response = await apiFetch<unknown>(upstream.path, {
      method: upstream.method,
      accessToken,
      body: JSON.stringify(upstream.body),
    });

    return secureJson(upstream.parse(response), upstream.created ? 201 : 200);
  } catch (error) {
    return bffErrorResponse(error, "operations-control change");
  }
}
