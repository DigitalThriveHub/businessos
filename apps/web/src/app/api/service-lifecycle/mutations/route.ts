import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { lifecycleMutationSchema } from "@/lib/service-lifecycle";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  readSameOriginJson,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();
    const input = lifecycleMutationSchema.parse(
      await readSameOriginJson(request),
    );
    const base = `/api/v1/organisations/${encodeURIComponent(input.organisationId)}/service-lifecycle`;
    let path: string;
    let body: unknown;
    switch (input.operation) {
      case "engagement.create":
        path = `${base}/engagements`;
        body = input.payload;
        break;
      case "engagement.accept":
        path = `${base}/engagements/${encodeURIComponent(input.engagementId)}/accept`;
        body = {};
        break;
      case "exception.create":
        path = `${base}/exceptions`;
        body = input.payload;
        break;
      case "exception.resolve":
        path = `${base}/exceptions/${encodeURIComponent(input.exceptionId)}/resolve`;
        body = { resolution: input.resolution };
        break;
    }
    return secureJson(
      await apiFetch(path, {
        method: "POST",
        accessToken,
        body: JSON.stringify(body),
      }),
      200,
    );
  } catch (error) {
    return bffErrorResponse(error, "service-lifecycle change");
  }
}
