import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiFetch } from "@/lib/api";
import {
  createEnquirySchema,
  enquiryListResponseSchema,
  enquiryQuerySchema,
  enquirySchema,
} from "@/lib/enquiries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SECURITY_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
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
            ? "The requested resource was not found."
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

export async function GET(request: NextRequest) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return NextResponse.json(
      { message: "Authentication is required." },
      {
        status: 401,
        headers: SECURITY_HEADERS,
      },
    );
  }

  try {
    const input = enquiryQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    const query = new URLSearchParams({
      organisationId: input.organisationId,
      page: String(input.page),
      limit: String(input.limit),
    });

    if (input.status) {
      query.set("status", input.status);
    }

    if (input.priority) {
      query.set("priority", input.priority);
    }

    if (input.assignedToUserId) {
      query.set("assignedToUserId", input.assignedToUserId);
    }

    if (input.search) {
      query.set("search", input.search);
    }

    const upstreamResponse = await apiFetch<unknown>(
      `/api/v1/enquiries?${query.toString()}`,
      {
        method: "GET",
        accessToken,
      },
    );

    const response = enquiryListResponseSchema.parse(upstreamResponse);

    return NextResponse.json(response, {
      status: 200,
      headers: SECURITY_HEADERS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return NextResponse.json(
      { message: "Authentication is required." },
      {
        status: 401,
        headers: SECURITY_HEADERS,
      },
    );
  }

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

  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > 25_000
  ) {
    return NextResponse.json(
      { message: "The request is too large." },
      {
        status: 413,
        headers: SECURITY_HEADERS,
      },
    );
  }

  try {
    const body: unknown = await request.json();
    const input = createEnquirySchema.parse(body);

    const upstreamResponse = await apiFetch<unknown>("/api/v1/enquiries", {
      method: "POST",
      accessToken,
      body: JSON.stringify(input),
    });

    const enquiry = enquirySchema.parse(upstreamResponse);

    return NextResponse.json(enquiry, {
      status: 201,
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