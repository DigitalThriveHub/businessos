import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  benchmarkUpdateResultSchema,
  documentReviewResultSchema,
  operationalIntelligenceMutationSchema,
} from "@/lib/operational-intelligence";
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
    const input = operationalIntelligenceMutationSchema.parse(
      await readSameOriginJson(request, 16_000),
    );
    const basePath = `/api/v1/organisations/${encodeURIComponent(
      input.organisationId,
    )}/operational-intelligence`;

    if (input.operation === "document.review") {
      const response = await apiFetch<unknown>(
        `${basePath}/documents/${encodeURIComponent(input.analysisId)}/review`,
        {
          method: "POST",
          accessToken,
          body: JSON.stringify(input.payload),
          timeoutMs: 20_000,
        },
      );
      return secureJson(documentReviewResultSchema.parse(response));
    }

    const response = await apiFetch<unknown>(
      `${basePath}/benchmarks/${encodeURIComponent(input.benchmarkId)}`,
      {
        method: "PATCH",
        accessToken,
        body: JSON.stringify(input.payload),
        timeoutMs: 20_000,
      },
    );
    return secureJson(benchmarkUpdateResultSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "operational-intelligence mutation");
  }
}
