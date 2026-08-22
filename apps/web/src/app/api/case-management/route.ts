


import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  caseManagementOptionsSchema,
  caseManagementReadQuerySchema,
  clientListSchema,
  clientSchema,
  matterListSchema,
  matterSchema,
} from "@/lib/case-management";
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

    const input = caseManagementReadQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const base = `/api/v1/organisations/${encodeURIComponent(
      input.organisationId,
    )}/case-management`;
    let path: string;
    let parse: (value: unknown) => unknown;

    switch (input.resource) {
      case "options":
        path = `${base}/options`;
        parse = (value) => caseManagementOptionsSchema.parse(value);
        break;
      case "client":
        if (!input.id) {
          throw new Error("A client identifier is required.");
        }
        path = `${base}/clients/${encodeURIComponent(input.id)}`;
        parse = (value) => clientSchema.parse(value);
        break;
      case "matter":
        if (!input.id) {
          throw new Error("A matter identifier is required.");
        }
        path = `${base}/matters/${encodeURIComponent(input.id)}`;
        parse = (value) => matterSchema.parse(value);
        break;
      case "clients": {
        const query = new URLSearchParams({
          page: String(input.page),
          limit: String(input.limit),
        });
        if (input.search) query.set("search", input.search);
        if (input.status) query.set("status", input.status);
        if (input.assignedToUserId) {
          query.set("assignedToUserId", input.assignedToUserId);
        }
        path = `${base}/clients?${query.toString()}`;
        parse = (value) => clientListSchema.parse(value);
        break;
      }
      case "matters": {
        const query = new URLSearchParams({
          page: String(input.page),
          limit: String(input.limit),
        });
        if (input.search) query.set("search", input.search);
        if (input.status) query.set("status", input.status);
        if (input.priority) query.set("priority", input.priority);
        if (input.assignedToUserId) {
          query.set("assignedToUserId", input.assignedToUserId);
        }
        if (input.clientId) query.set("clientId", input.clientId);
        path = `${base}/matters?${query.toString()}`;
        parse = (value) => matterListSchema.parse(value);
        break;
      }
    }

    const response = await apiFetch<unknown>(path, {
      method: "GET",
      accessToken,
    });
    return secureJson(parse(response));
  } catch (error) {
    return bffErrorResponse(error, "case-management information");
  }
}