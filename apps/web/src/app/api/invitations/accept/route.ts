import {
  type NextRequest,
} from "next/server";
import { z } from "zod";

import {
  apiFetch,
} from "@/lib/api";
import {
  authenticationRequiredResponse,
  bffErrorResponse,
  getVerifiedAccessToken,
  readSameOriginJson,
  secureJson,
} from "@/lib/security/bff-route";

export const dynamic = "force-dynamic";

const MAX_ACCEPTANCE_BODY_BYTES = 1_024;

const acceptanceRequestSchema = z
  .object({
    token: z
      .string()
      .trim()
      .length(50)
      .regex(
        /^boi_v1_[A-Za-z0-9_-]{43}$/,
        "The invitation link is invalid or has expired.",
      ),
  })
  .strict();

const acceptedInvitationSchema = z
  .object({
    invitationId: z.string().uuid(),
    organisationId: z.string().uuid(),
    organisationName: z
      .string()
      .trim()
      .min(1)
      .max(200),
    organisationSlug: z
      .string()
      .trim()
      .min(1)
      .max(80),
    membershipId: z.string().uuid(),
    status: z.literal("ACCEPTED"),
    roleKeys: z
      .array(
        z.string().trim().min(1).max(100),
      )
      .min(1)
      .max(8),
    jobTitle: z
      .string()
      .trim()
      .max(120)
      .nullable(),
  })
  .strict();

export async function POST(
  request: NextRequest,
) {
  try {
    const accessToken =
      await getVerifiedAccessToken();

    if (!accessToken) {
      return authenticationRequiredResponse();
    }

    const rawBody =
      await readSameOriginJson(
        request,
        MAX_ACCEPTANCE_BODY_BYTES,
      );

    const input =
      acceptanceRequestSchema.parse(
        rawBody,
      );

    const upstreamResponse =
      await apiFetch<unknown>(
        "/api/v1/invitations/accept",
        {
          method: "POST",
          accessToken,
          timeoutMs: 10_000,
          body: JSON.stringify(input),
        },
      );

    const acceptedInvitation =
      acceptedInvitationSchema.parse(
        upstreamResponse,
      );

    return secureJson(
      acceptedInvitation,
    );
  } catch (error) {
    return bffErrorResponse(
      error,
      "invitation acceptance",
    );
  }
}