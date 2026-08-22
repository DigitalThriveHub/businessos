import "server-only";

import {
  type NextRequest,
  NextResponse,
} from "next/server";
import { ZodError } from "zod";

import { ApiError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export const BFF_SECURITY_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export class BffRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BffRequestError";
  }
}

export function secureJson(
  body: unknown,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: BFF_SECURITY_HEADERS,
  });
}

export function authenticationRequiredResponse():
  NextResponse {
  return secureJson(
    {
      message:
        "Authentication is required.",
    },
    401,
  );
}

export async function getVerifiedAccessToken():
  Promise<string | null> {
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

  if (
    sessionError ||
    !session?.access_token
  ) {
    return null;
  }

  return session.access_token;
}

function isSameOrigin(
  request: NextRequest,
): boolean {
  const fetchSite = request.headers
    .get("sec-fetch-site")
    ?.toLowerCase();

  if (
    fetchSite &&
    fetchSite !== "same-origin"
  ) {
    return false;
  }

  const originHeader =
    request.headers.get("origin");

  if (!originHeader) {
    return fetchSite === "same-origin";
  }

  const requestHost = request.headers
    .get("host")
    ?.trim()
    .toLowerCase();

  if (!requestHost) {
    return false;
  }

  try {
    const origin = new URL(originHeader);

    return (
      origin.host.toLowerCase() ===
      requestHost
    );
  } catch {
    return false;
  }
}

export async function readSameOriginJson(
  request: NextRequest,
  maximumBytes = 12_000,
): Promise<unknown> {
  if (!isSameOrigin(request)) {
    throw new BffRequestError(
      403,
      "The request origin could not be verified.",
    );
  }

  const contentType =
    request.headers.get("content-type");

  if (
    !contentType
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new BffRequestError(
      415,
      "Content-Type must be application/json.",
    );
  }

  const contentLength =
    request.headers.get("content-length");

  if (contentLength !== null) {
    const declaredBytes =
      Number(contentLength);

    if (
      !Number.isInteger(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > maximumBytes
    ) {
      throw new BffRequestError(
        413,
        "The request is too large.",
      );
    }
  }

  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    throw new BffRequestError(
      400,
      "The request body could not be read.",
    );
  }

  if (
    new TextEncoder().encode(rawBody)
      .byteLength > maximumBytes
  ) {
    throw new BffRequestError(
      413,
      "The request is too large.",
    );
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new BffRequestError(
      400,
      "The request body must contain valid JSON.",
    );
  }
}

export function bffErrorResponse(
  error: unknown,
  subject: string,
): NextResponse {
  if (error instanceof BffRequestError) {
    return secureJson(
      {
        message: error.message,
      },
      error.status,
    );
  }

  if (error instanceof ZodError) {
    return secureJson(
      {
        message:
          "The submitted information is invalid.",
        issues: error.issues.map(
          (issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          }),
        ),
      },
      400,
    );
  }

  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return secureJson(
          {
            message:
              `The submitted ${subject} information is invalid.`,
          },
          400,
        );

      case 401:
        return authenticationRequiredResponse();

      case 403:
        return secureJson(
          {
            message:
              "You do not have permission to perform this action.",
          },
          403,
        );

      case 404:
        return secureJson(
          {
            message:
              `The requested ${subject} could not be found.`,
          },
          404,
        );

      case 409:
        return secureJson(
          {
            message:
              `The ${subject} conflicts with an existing record.`,
          },
          409,
        );

      case 422:
        return secureJson(
          {
            message:
              `The ${subject} could not be accepted.`,
          },
          422,
        );

      case 429:
        return secureJson(
          {
            message:
              "Too many requests. Please try again shortly.",
          },
          429,
        );

      case 500:
      case 502:
      case 503:
      case 504:
        return secureJson(
          {
            message:
              `The ${subject} service is temporarily unavailable.`,
          },
          503,
        );

      default:
        return secureJson(
          {
            message:
              `The ${subject} request could not be completed.`,
          },
          500,
        );
    }
  }

  return secureJson(
    {
      message:
        `The ${subject} service is temporarily unavailable.`,
    },
    500,
  );
}