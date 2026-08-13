"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { ApiError, apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function optionalText(maxLength: number) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === ""
        ? undefined
        : value,
    z
      .string()
      .trim()
      .max(maxLength)
      .refine(
        (value) => !CONTROL_CHARACTERS.test(value),
        "This field contains unsupported characters.",
      )
      .optional(),
  );
}

const onboardingSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organisation name must contain at least 2 characters.")
    .max(200, "Organisation name is too long.")
    .refine(
      (value) => !CONTROL_CHARACTERS.test(value),
      "Organisation name contains unsupported characters.",
    ),

  slug: z
    .string()
    .trim()
    .min(2, "Organisation URL must contain at least 2 characters.")
    .max(80, "Organisation URL is too long.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers and single hyphens only.",
    ),

  legalName: optionalText(250),
  ownerDisplayName: optionalText(200),
  ownerFirstName: optionalText(100),
  ownerLastName: optionalText(100),
  ownerJobTitle: optionalText(160),
});

export type OnboardingActionState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: {
    name?: string[];
    slug?: string[];
    legalName?: string[];
    ownerDisplayName?: string[];
    ownerFirstName?: string[];
    ownerLastName?: string[];
    ownerJobTitle?: string[];
  };
};

type BootstrapOrganisationResult = {
  organisationId: string;
  organisationSlug: string;
  membershipId: string;
  ownerRoleId: string;
  ownerRoleAssignmentId: string;
  status: "ACTIVE";
};

export async function createOrganisation(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const validation = onboardingSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    legalName: formData.get("legalName"),
    ownerDisplayName: formData.get("ownerDisplayName"),
    ownerFirstName: formData.get("ownerFirstName"),
    ownerLastName: formData.get("ownerLastName"),
    ownerJobTitle: formData.get("ownerJobTitle"),
  });

  if (!validation.success) {
    const errors = validation.error.flatten().fieldErrors;

    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: {
        name: errors.name,
        slug: errors.slug,
        legalName: errors.legalName,
        ownerDisplayName: errors.ownerDisplayName,
        ownerFirstName: errors.ownerFirstName,
        ownerLastName: errors.ownerLastName,
        ownerJobTitle: errors.ownerJobTitle,
      },
    };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?returnTo=%2Fonboarding");
  }

  if (!user.email) {
    return {
      status: "error",
      message:
        "Your authenticated account does not contain a valid email address.",
    };
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    redirect("/login?returnTo=%2Fonboarding");
  }

  try {
    const result =
      await apiFetch<BootstrapOrganisationResult>(
        "/api/v1/bootstrap/organisation",
        {
          method: "POST",
          accessToken: session.access_token,
          body: JSON.stringify({
            ...validation.data,

            // Never trust an owner email submitted by the browser.
            ownerEmail: user.email.trim().toLowerCase(),

            timezone: "Europe/London",
            locale: "en-GB",
            countryCode: "GB",
          }),
        },
      );

    if (result.status !== "ACTIVE") {
      return {
        status: "error",
        message:
          "The organisation could not be activated. Please try again.",
      };
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        redirect("/login?returnTo=%2Fonboarding");
      }

      if (error.status === 400) {
        return {
          status: "error",
          message:
            "The organisation details are invalid. Check each field and try again.",
        };
      }

      if (error.status === 403) {
        return {
          status: "error",
          message:
            "This account is not authorised to create the organisation.",
        };
      }

      if (error.status === 409) {
        return {
          status: "error",
          message:
            "This account or organisation URL is already registered.",
        };
      }

      if (
        error.status === 503 ||
        error.status === 504
      ) {
        return {
          status: "error",
          message:
            "The secure organisation service is temporarily unavailable. Please try again.",
        };
      }
    }

    return {
      status: "error",
      message:
        "The organisation could not be created. Please try again.",
    };
  }

  redirect("/dashboard");
}