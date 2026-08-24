import type { NextRequest } from "next/server";
import { apiFetch } from "@/lib/api";
import { pilotMutationSchema } from "@/lib/pilot-readiness";
import { authenticationRequiredResponse, bffErrorResponse, getVerifiedAccessToken, readSameOriginJson, secureJson } from "@/lib/security/bff-route";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();
    const input = pilotMutationSchema.parse(await readSameOriginJson(request));
    const base = `/api/v1/organisations/${encodeURIComponent(input.organisationId)}/pilot-readiness`;
    let path: string;
    if (input.operation === "acceptance.record") path = `${base}/acceptances`;
    else if (input.operation === "feedback.create") path = `${base}/feedback`;
    else path = `${base}/feedback/${encodeURIComponent(input.feedbackId)}/resolve`;
    return secureJson(await apiFetch(path, { method: "POST", accessToken, body: JSON.stringify(input.payload) }));
  } catch (error) { return bffErrorResponse(error, "pilot-readiness change"); }
}
