import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiFetch } from "@/lib/api";
import {
  enquirySchema,
  updateEnquirySchema,
} from "@/lib/enquiries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const routeParametersSchema = z.object({
  id: z.string().uuid(),
});

const organisationQuerySchema = z.object({
  organisationId: z.string().uuid(),
});

const SECURITY_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        message: "The submitted information is invalid.",
        issues: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      {
        status: 400,
        headers: SECURITY_HEADERS,
      },
    );
  }

  if (error instanceof ApiError) {
    const message =
      error.status === 401
        ? "Authentication is required."
        : error.status === 403
          ? "You do not have permission to perform this action."
          : error.status === 404
            ? "The enquiry could not be found."
            : "The enquiry service is temporarily unavailable.";

    return NextResponse.json(
      { message },
      {
        status: error.status,
        headers: SECURITY_HEADERS,
      },
    );
  }

  return NextResponse.json(
    { message: "The enquiry service is temporarily unavailable." },
    {
      status: 500,
      headers: SECURITY_HEADERS,
    },
  );
}

async function getAccessToken(): Promise<string | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    return null;
  }

  return session.access_token;
}

function authenticationError(): NextResponse {
  return NextResponse.json(
    { message: "Authentication is required." },
    {
      status: 401,
      headers: SECURITY_HEADERS,
    },
  );
}

function validateJsonRequest(request: NextRequest): NextResponse | null {
  const contentType = request.headers.get("content-type");

  if (!contentType?.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { message: "Content-Type must be application/json." },
      {
        status: 415,
        headers: SECURITY_HEADERS,
      },
    );
  }

  const contentLengthHeader = request.headers.get("content-length");

  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);

    if (
      !Number.isFinite(contentLength) ||
      contentLength < 0 ||
      contentLength > 25_000
    ) {
      return NextResponse.json(
        { message: "The request is too large." },
        {
          status: 413,
          headers: SECURITY_HEADERS,
        },
      );
    }
  }

  return null;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return authenticationError();
  }

  try {
    const { id } = routeParametersSchema.parse(await context.params);

    const { organisationId } = organisationQuerySchema.parse({
      organisationId: request.nextUrl.searchParams.get("organisationId"),
    });

    const query = new URLSearchParams({ organisationId });

    const upstreamResponse = await apiFetch<unknown>(
      `/api/v1/enquiries/${encodeURIComponent(id)}?${query.toString()}`,
      {
        method: "GET",
        accessToken,
      },
    );

    const enquiry = enquirySchema.parse(upstreamResponse);

    return NextResponse.json(enquiry, {
      status: 200,
      headers: SECURITY_HEADERS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return authenticationError();
  }

  const requestError = validateJsonRequest(request);

  if (requestError) {
    return requestError;
  }

  try {
    const { id } = routeParametersSchema.parse(await context.params);

    const { organisationId } = organisationQuerySchema.parse({
      organisationId: request.nextUrl.searchParams.get("organisationId"),
    });

    const body: unknown = await request.json();
    const input = updateEnquirySchema.parse(body);

    if (Object.keys(input).length === 0) {
      return NextResponse.json(
        { message: "At least one enquiry field must be provided." },
        {
          status: 400,
          headers: SECURITY_HEADERS,
        },
      );
    }

    const query = new URLSearchParams({ organisationId });

    const upstreamResponse = await apiFetch<unknown>(
      `/api/v1/enquiries/${encodeURIComponent(id)}?${query.toString()}`,
      {
        method: "PATCH",
        accessToken,
        body: JSON.stringify(input),
      },
    );

    const enquiry = enquirySchema.parse(upstreamResponse);

    return NextResponse.json(enquiry, {
      status: 200,
      headers: SECURITY_HEADERS,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: "The request body contains invalid JSON." },
        {
          status: 400,
          headers: SECURITY_HEADERS,
        },
      );
    }

    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return authenticationError();
  }

  try {
    const { id } = routeParametersSchema.parse(await context.params);

    const { organisationId } = organisationQuerySchema.parse({
      organisationId: request.nextUrl.searchParams.get("organisationId"),
    });

    const query = new URLSearchParams({ organisationId });

    await apiFetch<unknown>(
      `/api/v1/enquiries/${encodeURIComponent(id)}?${query.toString()}`,
      {
        method: "DELETE",
        accessToken,
      },
    );

    return new NextResponse(null, {
      status: 204,
      headers: SECURITY_HEADERS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}