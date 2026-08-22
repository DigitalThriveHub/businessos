import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  type FinanceMutation,
  financeDocumentSchema,
  financeMutationSchema,
  financePaymentSchema,
  financeSettingsSchema,
} from "@/lib/finance";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  readSameOriginJson,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

type Upstream = {
  method: "POST" | "PATCH";
  path: string;
  body: unknown;
  created: boolean;
  parse: (value: unknown) => unknown;
};

function upstream(input: FinanceMutation): Upstream {
  const base = `/api/v1/organisations/${encodeURIComponent(
    input.organisationId,
  )}/finance`;

  switch (input.operation) {
    case "settings.update":
      return {
        method: "PATCH",
        path: `${base}/settings`,
        body: input.payload,
        created: false,
        parse: (value) => financeSettingsSchema.parse(value),
      };
    case "document.create":
      return {
        method: "POST",
        path: `${base}/documents`,
        body: input.payload,
        created: true,
        parse: (value) => financeDocumentSchema.parse(value),
      };
    case "document.issue":
      return {
        method: "POST",
        path: `${base}/documents/${encodeURIComponent(input.documentId)}/issue`,
        body: input.payload,
        created: false,
        parse: (value) => financeDocumentSchema.parse(value),
      };
    case "document.void":
      return {
        method: "POST",
        path: `${base}/documents/${encodeURIComponent(input.documentId)}/void`,
        body: input.payload,
        created: false,
        parse: (value) => financeDocumentSchema.parse(value),
      };
    case "payment.record":
      return {
        method: "POST",
        path: `${base}/payments`,
        body: input.payload,
        created: true,
        parse: (value) => financePaymentSchema.parse(value),
      };
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();
    if (!accessToken) return authenticationRequiredResponse();

    const input = financeMutationSchema.parse(
      await readSameOriginJson(request),
    );
    const target = upstream(input);
    const response = await apiFetch<unknown>(target.path, {
      method: target.method,
      accessToken,
      body: JSON.stringify(target.body),
    });
    return secureJson(target.parse(response), target.created ? 201 : 200);
  } catch (error) {
    return bffErrorResponse(error, "finance change");
  }
}
