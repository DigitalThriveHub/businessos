import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  myAiCommandResultSchema,
  myAiMutationSchema,
} from "@/lib/my-ai";
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

    const input = myAiMutationSchema.parse(
      await readSameOriginJson(request, 16_000),
    );
    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        input.organisationId,
      )}/my-ai/commands`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify(input.payload),
        timeoutMs: 45_000,
      },
    );

    return secureJson(myAiCommandResultSchema.parse(response), 201);
  } catch (error) {
    return bffErrorResponse(error, "personal AI command");
  }
}
