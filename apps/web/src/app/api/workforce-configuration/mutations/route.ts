import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  type WorkforceMutationRequest,
  workforceMutationRequestSchema,
  workforceMutationResultSchema,
} from "@/lib/workforce-configuration";
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
};

function upstreamMutation(input: WorkforceMutationRequest): UpstreamMutation {
  const base = `/api/v1/organisations/${encodeURIComponent(
    input.organisationId,
  )}/workforce-configuration`;

  switch (input.operation) {
    case "department.create":
      return { method: "POST", path: `${base}/departments`, body: input.payload };
    case "department.update":
      return {
        method: "PATCH",
        path: `${base}/departments/${encodeURIComponent(input.departmentId)}`,
        body: input.payload,
      };
    case "team.create":
      return { method: "POST", path: `${base}/teams`, body: input.payload };
    case "team.update":
      return {
        method: "PATCH",
        path: `${base}/teams/${encodeURIComponent(input.teamId)}`,
        body: input.payload,
      };
    case "kpi_definition.create":
      return {
        method: "POST",
        path: `${base}/kpi-definitions`,
        body: input.payload,
      };
    case "kpi_definition.update":
      return {
        method: "PATCH",
        path: `${base}/kpi-definitions/${encodeURIComponent(
          input.kpiDefinitionId,
        )}`,
        body: input.payload,
      };
    case "job_profile.create":
      return {
        method: "POST",
        path: `${base}/job-profiles`,
        body: input.payload,
      };
    case "job_profile.update":
      return {
        method: "PATCH",
        path: `${base}/job-profiles/${encodeURIComponent(input.jobProfileId)}`,
        body: input.payload,
      };
    case "job_profile_duty.create":
      return {
        method: "POST",
        path: `${base}/job-profiles/${encodeURIComponent(
          input.jobProfileId,
        )}/duties`,
        body: input.payload,
      };
    case "job_profile_duty.update":
      return {
        method: "PATCH",
        path: `${base}/job-profiles/${encodeURIComponent(
          input.jobProfileId,
        )}/duties/${encodeURIComponent(input.dutyId)}`,
        body: input.payload,
      };
    case "job_profile_kpi.create":
      return {
        method: "POST",
        path: `${base}/job-profiles/${encodeURIComponent(
          input.jobProfileId,
        )}/kpis`,
        body: input.payload,
      };
    case "job_profile_kpi.update":
      return {
        method: "PATCH",
        path: `${base}/job-profiles/${encodeURIComponent(
          input.jobProfileId,
        )}/kpis/${encodeURIComponent(input.assignmentId)}`,
        body: input.payload,
      };
    case "agent_profile.create":
      return {
        method: "POST",
        path: `${base}/agent-profiles`,
        body: input.payload,
      };
    case "agent_profile.update":
      return {
        method: "PATCH",
        path: `${base}/agent-profiles/${encodeURIComponent(
          input.agentProfileId,
        )}`,
        body: input.payload,
      };
    case "agent_policy.create":
      return {
        method: "POST",
        path: `${base}/agent-profiles/${encodeURIComponent(
          input.agentProfileId,
        )}/policies`,
        body: input.payload,
      };
    case "agent_policy.update":
      return {
        method: "PATCH",
        path: `${base}/agent-profiles/${encodeURIComponent(
          input.agentProfileId,
        )}/policies/${encodeURIComponent(input.policyId)}`,
        body: input.payload,
      };
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = await getVerifiedAccessToken();

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const input = workforceMutationRequestSchema.parse(
      await readSameOriginJson(request),
    );
    const upstream = upstreamMutation(input);
    const response = await apiFetch<unknown>(upstream.path, {
      method: upstream.method,
      accessToken,
      body: JSON.stringify(upstream.body),
    });

    return secureJson(
      workforceMutationResultSchema.parse(response),
      upstream.method === "POST" ? 201 : 200,
    );
  } catch (error) {
    return bffErrorResponse(error, "workforce configuration change");
  }
}