import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  myAiReadQuerySchema,
  myAiWorkspaceSchema,
} from "@/lib/my-ai";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();

    const input = myAiReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const query = new URLSearchParams();
    if (input.conversationId) {
      query.set("conversationId", input.conversationId);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const response = await apiFetch<unknown>(
      `/api/v1/organisations/${encodeURIComponent(
        input.organisationId,
      )}/my-ai${suffix}`,
      { method: "GET", accessToken },
    );

    return secureJson(myAiWorkspaceSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "personal AI workspace");
  }
}
