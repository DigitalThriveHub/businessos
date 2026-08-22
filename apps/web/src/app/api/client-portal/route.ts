import { apiFetch } from "@/lib/api";
import { clientPortalDashboardSchema } from "@/lib/client-portal";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();

    const response = await apiFetch<unknown>("/api/v1/client-portal", {
      method: "GET",
      accessToken,
    });
    return secureJson(clientPortalDashboardSchema.parse(response));
  } catch (error) {
    return bffErrorResponse(error, "client portal information");
  }
}
