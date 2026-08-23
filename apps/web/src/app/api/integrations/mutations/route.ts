import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  type IntegrationMutation,
  integrationConnectionSchema,
  integrationMutationSchema,
} from "@/lib/integrations";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  readSameOriginJson,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

function upstream(input: IntegrationMutation): {
  path: string;
  method: "POST" | "PATCH";
  created: boolean;
  body: unknown;
} {
  const base = `/api/v1/organisations/${encodeURIComponent(
    input.organisationId,
  )}/integrations`;

  switch (input.operation) {
    case "connection.create":
      return {
        path: `${base}/connections`,
        method: "POST",
        created: true,
        body: input.payload,
      };
    case "connection.status":
      return {
        path: `${base}/connections/${encodeURIComponent(
          input.connectionId,
        )}/status`,
        method: "PATCH",
        created: false,
        body: input.payload,
      };
    case "connection.rotate-secret":
      return {
        path: `${base}/connections/${encodeURIComponent(
          input.connectionId,
        )}/rotate-secret`,
        method: "POST",
        created: false,
        body: input.payload,
      };
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();

    const input = integrationMutationSchema.parse(
      await readSameOriginJson(request),
    );
    const target = upstream(input);
    const response = await apiFetch<unknown>(target.path, {
      method: target.method,
      accessToken,
      body: JSON.stringify(target.body),
    });

    return secureJson(
      integrationConnectionSchema.parse(response),
      target.created ? 201 : 200,
    );
  } catch (error) {
    return bffErrorResponse(error, "integration change");
  }
}
