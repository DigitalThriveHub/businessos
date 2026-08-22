import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  type CaseManagementMutation,
  caseManagementMutationSchema,
  clientSchema,
  conversionResultSchema,
  matterComplianceSchema,
  matterPartySchema,
  matterSchema,
} from "@/lib/case-management";
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

function upstreamMutation(input: CaseManagementMutation): UpstreamMutation {
  const base = `/api/v1/organisations/${encodeURIComponent(
    input.organisationId,
  )}/case-management`;

  switch (input.operation) {
    case "client.create":
      return {
        method: "POST",
        path: `${base}/clients`,
        body: input.payload,
        created: true,
        parse: (value) => clientSchema.parse(value),
      };

    case "client.update":
      return {
        method: "PATCH",
        path: `${base}/clients/${encodeURIComponent(input.clientId)}`,
        body: input.payload,
        created: false,
        parse: (value) => clientSchema.parse(value),
      };

    case "client.archive":
      return {
        method: "POST",
        path: `${base}/clients/${encodeURIComponent(input.clientId)}/archive`,
        body: input.payload,
        created: false,
        parse: (value) => clientSchema.parse(value),
      };

    case "matter.create":
      return {
        method: "POST",
        path: `${base}/matters`,
        body: input.payload,
        created: true,
        parse: (value) => matterSchema.parse(value),
      };

    case "matter.update":
      return {
        method: "PATCH",
        path: `${base}/matters/${encodeURIComponent(input.matterId)}`,
        body: input.payload,
        created: false,
        parse: (value) => matterSchema.parse(value),
      };

    case "matter.status":
      return {
        method: "POST",
        path: `${base}/matters/${encodeURIComponent(input.matterId)}/status`,
        body: input.payload,
        created: false,
        parse: (value) => matterSchema.parse(value),
      };

    case "matter.compliance":
      return {
        method: "PATCH",
        path: `${base}/matters/${encodeURIComponent(
          input.matterId,
        )}/compliance`,
        body: input.payload,
        created: false,
        parse: (value) => matterComplianceSchema.parse(value),
      };

    case "matter.party.add":
      return {
        method: "POST",
        path: `${base}/matters/${encodeURIComponent(input.matterId)}/parties`,
        body: input.payload,
        created: true,
        parse: (value) => matterPartySchema.parse(value),
      };

    case "matter.party.remove":
      return {
        method: "POST",
        path: `${base}/matters/${encodeURIComponent(
          input.matterId,
        )}/parties/${encodeURIComponent(input.partyId)}/remove`,
        body: input.payload,
        created: false,
        parse: (value) => matterPartySchema.parse(value),
      };

    case "enquiry.convert":
      return {
        method: "POST",
        path: `${base}/enquiries/${encodeURIComponent(
          input.enquiryId,
        )}/convert`,
        body: input.payload,
        created: true,
        parse: (value) => conversionResultSchema.parse(value),
      };
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const input = caseManagementMutationSchema.parse(
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
    return bffErrorResponse(error, "case-management change");
  }
}