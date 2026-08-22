import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  type CaseOperationsMutation,
  caseOperationsMutationSchema,
  documentProcessingSchema,
  documentRequestSchema,
  documentUploadRegistrationSchema,
  matterDeadlineSchema,
  matterDocumentSchema,
  matterTaskSchema,
} from "@/lib/case-operations";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  readSameOriginJson,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

type UpstreamMutation = {
  method: "POST" | "PATCH";
  path: string;
  body: unknown;
  created: boolean;
  parse: (value: unknown) => unknown;
};

function upstreamMutation(input: CaseOperationsMutation): UpstreamMutation {
  const base = `/api/v1/organisations/${encodeURIComponent(
    input.organisationId,
  )}/matters/${encodeURIComponent(input.matterId)}/operations`;

  switch (input.operation) {
    case "task.create":
      return {
        method: "POST",
        path: `${base}/tasks`,
        body: input.payload,
        created: true,
        parse: (value) => matterTaskSchema.parse(value),
      };

    case "task.update":
      return {
        method: "PATCH",
        path: `${base}/tasks/${encodeURIComponent(input.taskId)}`,
        body: input.payload,
        created: false,
        parse: (value) => matterTaskSchema.parse(value),
      };

    case "task.status":
      return {
        method: "POST",
        path: `${base}/tasks/${encodeURIComponent(input.taskId)}/status`,
        body: input.payload,
        created: false,
        parse: (value) => matterTaskSchema.parse(value),
      };

    case "deadline.create":
      return {
        method: "POST",
        path: `${base}/deadlines`,
        body: input.payload,
        created: true,
        parse: (value) => matterDeadlineSchema.parse(value),
      };

    case "deadline.update":
      return {
        method: "PATCH",
        path: `${base}/deadlines/${encodeURIComponent(input.deadlineId)}`,
        body: input.payload,
        created: false,
        parse: (value) => matterDeadlineSchema.parse(value),
      };

    case "deadline.status":
      return {
        method: "POST",
        path: `${base}/deadlines/${encodeURIComponent(
          input.deadlineId,
        )}/status`,
        body: input.payload,
        created: false,
        parse: (value) => matterDeadlineSchema.parse(value),
      };

    case "document-request.create":
      return {
        method: "POST",
        path: `${base}/document-requests`,
        body: input.payload,
        created: true,
        parse: (value) => documentRequestSchema.parse(value),
      };

    case "document-request.send":
      return {
        method: "POST",
        path: `${base}/document-requests/${encodeURIComponent(
          input.requestId,
        )}/send`,
        body: input.payload,
        created: false,
        parse: (value) => documentRequestSchema.parse(value),
      };

    case "document-request.status":
      return {
        method: "POST",
        path: `${base}/document-requests/${encodeURIComponent(
          input.requestId,
        )}/status`,
        body: input.payload,
        created: false,
        parse: (value) => documentRequestSchema.parse(value),
      };

    case "document.register":
      return {
        method: "POST",
        path: `${base}/documents/uploads`,
        body: input.payload,
        created: true,
        parse: (value) => documentUploadRegistrationSchema.parse(value),
      };

    case "document.version.register":
      return {
        method: "POST",
        path: `${base}/documents/${encodeURIComponent(
          input.documentId,
        )}/versions`,
        body: input.payload,
        created: true,
        parse: (value) => documentUploadRegistrationSchema.parse(value),
      };

    case "document.finalise":
      return {
        method: "POST",
        path: `${base}/documents/${encodeURIComponent(
          input.documentId,
        )}/versions/${encodeURIComponent(input.versionId)}/finalise`,
        body: input.payload,
        created: false,
        parse: (value) => documentProcessingSchema.parse(value),
      };

    case "document.update":
      return {
        method: "PATCH",
        path: `${base}/documents/${encodeURIComponent(input.documentId)}`,
        body: input.payload,
        created: false,
        parse: (value) => matterDocumentSchema.parse(value),
      };

    case "document.archive":
      return {
        method: "POST",
        path: `${base}/documents/${encodeURIComponent(
          input.documentId,
        )}/archive`,
        body: input.payload,
        created: false,
        parse: (value) => matterDocumentSchema.parse(value),
      };
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const input = caseOperationsMutationSchema.parse(
      await readSameOriginJson(request),
    );
    const upstream = upstreamMutation(input);

    const response = await apiFetch<unknown>(upstream.path, {
      method: upstream.method,
      accessToken,
      body: JSON.stringify(upstream.body),
    });

    return secureJson(upstream.parse(response), upstream.created ? 201 : 200);
  } catch (error) {
    return bffErrorResponse(error, "case-operation change");
  }
}