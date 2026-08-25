import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  complianceAssuranceMutationSchema,
  complianceMutationResultSchema,
} from "@/lib/compliance-assurance";
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
    const input = complianceAssuranceMutationSchema.parse(
      await readSameOriginJson(request, 32_000),
    );
    const basePath = `/api/v1/organisations/${encodeURIComponent(
      input.organisationId,
    )}/compliance-assurance`;
    let path: string;
    let method: "POST" | "PATCH" = "POST";
    let created = false;

    switch (input.operation) {
      case "right.create":
        path = `${basePath}/rights`;
        created = true;
        break;
      case "right.transition":
        path = `${basePath}/rights/${encodeURIComponent(input.requestId)}/transition`;
        break;
      case "right.extend":
        path = `${basePath}/rights/${encodeURIComponent(input.requestId)}/extend`;
        break;
      case "incident.create":
        path = `${basePath}/incidents`;
        created = true;
        break;
      case "incident.update":
        path = `${basePath}/incidents/${encodeURIComponent(input.incidentId)}`;
        method = "PATCH";
        break;
      case "hold.create":
        path = `${basePath}/legal-holds`;
        created = true;
        break;
      case "hold.release":
        path = `${basePath}/legal-holds/${encodeURIComponent(input.holdId)}/release`;
        break;
      case "policy.upsert":
        path = `${basePath}/retention-policies`;
        break;
      case "retention-review.create":
        path = `${basePath}/retention-reviews`;
        created = true;
        break;
      case "retention-review.decide":
        path = `${basePath}/retention-reviews/${encodeURIComponent(input.reviewId)}/decision`;
        break;
      case "evidence.record":
        path = `${basePath}/evidence`;
        break;
      case "evidence.review":
        path = `${basePath}/evidence/${encodeURIComponent(input.evidenceId)}/review`;
        break;
      case "release.decide":
        path = `${basePath}/release-decisions`;
        break;
    }

    const result = await apiFetch<unknown>(path, {
      method,
      accessToken,
      body: JSON.stringify(input.payload),
      timeoutMs: 30_000,
    });
    return secureJson(
      complianceMutationResultSchema.parse(result),
      created ? 201 : 200,
    );
  } catch (error) {
    return bffErrorResponse(error, "compliance-assurance mutation");
  }
}
