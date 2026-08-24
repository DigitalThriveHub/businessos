import type { NextRequest } from "next/server";
import { apiFetch } from "@/lib/api";
import {
  bffErrorResponse,
  getVerifiedAccessToken,
  secureJson,
} from "@/lib/security/bff-route";
export async function GET(request: NextRequest) {
  const token = await getVerifiedAccessToken();
  if (!token) return secureJson({ message: "Authentication required." }, 401);
  const organisationId = request.nextUrl.searchParams.get("organisationId");
  if (!organisationId)
    return secureJson({ message: "Organisation required." }, 400);
  try {
    const matterId = request.nextUrl.searchParams.get("matterId");
    const suffix = matterId
      ? `/matters/${encodeURIComponent(matterId)}/readiness`
      : "";
    return secureJson(
      await apiFetch(
        `/api/v1/organisations/${encodeURIComponent(organisationId)}/service-lifecycle${suffix}`,
        { accessToken: token },
      ),
      200,
    );
  } catch (error) {
    return bffErrorResponse(error, "service lifecycle");
  }
}
