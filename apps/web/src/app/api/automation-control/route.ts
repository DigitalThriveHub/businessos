import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  automationControlReadQuerySchema,
  automationControlSchema,
} from "@/lib/automation-control";
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

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const input = automationControlReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const path = `/api/v1/organisations/${encodeURIComponent(
      input.organisationId,
    )}/automation-control`;
    const response = await apiFetch<unknown>(path, {
      method: "GET",
      accessToken,
    });

    return secureJson(automationControlSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "operations-control information");
  }
}
