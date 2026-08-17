"use client";

import {
  type FormEvent,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  RotateCcw,
  Save,
  UserRound,
} from "lucide-react";

type EditableProfile = {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
};

type ProfileForm = {
  displayName: string;
  firstName: string;
  lastName: string;
};

type ProfilePatch = {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

type ProfileSettingsProps = {
  initialProfile: EditableProfile;
};

function formFromProfile(
  profile: EditableProfile,
): ProfileForm {
  return {
    displayName: profile.displayName ?? "",
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
  };
}

function normaliseOptionalName(
  value: string,
): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPatch(
  form: ProfileForm,
  profile: EditableProfile,
): ProfilePatch {
  const patch: ProfilePatch = {};

  const displayName = normaliseOptionalName(
    form.displayName,
  );

  const firstName = normaliseOptionalName(
    form.firstName,
  );

  const lastName = normaliseOptionalName(
    form.lastName,
  );

  if (displayName !== profile.displayName) {
    patch.displayName = displayName;
  }

  if (firstName !== profile.firstName) {
    patch.firstName = firstName;
  }

  if (lastName !== profile.lastName) {
    patch.lastName = lastName;
  }

  return patch;
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNullableString(
  value: unknown,
): value is string | null {
  return value === null || typeof value === "string";
}

function isProfileResponse(
  value: unknown,
): value is EditableProfile {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    isNullableString(value.displayName) &&
    isNullableString(value.firstName) &&
    isNullableString(value.lastName)
  );
}

function responseMessage(
  value: unknown,
): string | undefined {
  if (
    isObject(value) &&
    typeof value.message === "string"
  ) {
    return value.message;
  }

  return undefined;
}

export function ProfileSettings({
  initialProfile,
}: ProfileSettingsProps) {
  const router = useRouter();

  const [profile, setProfile] =
    useState(initialProfile);

  const [form, setForm] = useState(
    formFromProfile(initialProfile),
  );

  const [status, setStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");

  const [message, setMessage] =
    useState<string>();

  const patch = useMemo(
    () => buildPatch(form, profile),
    [form, profile],
  );

  const hasChanges =
    Object.keys(patch).length > 0;

  function updateField(
    field: keyof ProfileForm,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

    if (
      status === "success" ||
      status === "error"
    ) {
      setStatus("idle");
      setMessage(undefined);
    }
  }

  function resetForm() {
    setForm(formFromProfile(profile));
    setStatus("idle");
    setMessage(undefined);
  }

  async function saveProfile(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!hasChanges || status === "saving") {
      return;
    }

    setStatus("saving");
    setMessage(undefined);

    const controller = new AbortController();

    const timeout = window.setTimeout(
      () => controller.abort(),
      15_000,
    );

    try {
      const response = await fetch(
        "/api/auth/me",
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(patch),
          signal: controller.signal,
        },
      );

      const body: unknown = await response
        .json()
        .catch(() => null);

      if (response.status === 401) {
        router.push(
          "/login?returnTo=%2Fsettings%2Fprofile",
        );
        return;
      }

      if (!response.ok) {
        throw new Error(
          responseMessage(body) ??
            "Your profile could not be updated.",
        );
      }

      if (!isProfileResponse(body)) {
        throw new Error(
          "The account service returned an invalid response.",
        );
      }

      setProfile(body);
      setForm(formFromProfile(body));
      setStatus("success");
      setMessage(
        "Profile updated successfully.",
      );

      /*
       * Refreshes server-rendered account information, including
       * the persistent shell display name, without a full browser
       * page reload.
       */
      router.refresh();
    } catch (error) {
      const timedOut =
        error instanceof DOMException &&
        error.name === "AbortError";

      setStatus("error");
      setMessage(
        timedOut
          ? "The profile update timed out. Please try again."
          : error instanceof Error
            ? error.message
            : "Your profile could not be updated.",
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
          <UserRound
            aria-hidden="true"
            className="h-5 w-5"
          />
        </div>

        <div>
          <h2 className="text-lg font-semibold">
            Personal details
          </h2>

          <p className="mt-1 text-sm leading-6 text-slate-600">
            Update the name displayed throughout your
            BusinessOS workspace.
          </p>
        </div>
      </div>

      {message ? (
        <div
          role={
            status === "error"
              ? "alert"
              : "status"
          }
          className={
            status === "error"
              ? "mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              : "mt-6 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          }
        >
          {status === "success" ? (
            <CheckCircle2
              aria-hidden="true"
              className="h-4 w-4 shrink-0"
            />
          ) : null}

          {message}
        </div>
      ) : null}

      <form
        className="mt-7 space-y-6"
        onSubmit={saveProfile}
      >
        <div>
          <label
            htmlFor="profile-email"
            className="block text-sm font-medium"
          >
            Email address
          </label>

          <input
            id="profile-email"
            type="email"
            value={profile.email}
            readOnly
            autoComplete="email"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-slate-600 outline-none"
          />

          <p className="mt-2 text-xs leading-5 text-slate-500">
            Email changes require a separate verified
            security process.
          </p>
        </div>

        <div>
          <label
            htmlFor="profile-display-name"
            className="block text-sm font-medium"
          >
            Display name
          </label>

          <input
            id="profile-display-name"
            value={form.displayName}
            onChange={(event) =>
              updateField(
                "displayName",
                event.target.value,
              )
            }
            maxLength={200}
            autoComplete="name"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-200"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="profile-first-name"
              className="block text-sm font-medium"
            >
              First name
            </label>

            <input
              id="profile-first-name"
              value={form.firstName}
              onChange={(event) =>
                updateField(
                  "firstName",
                  event.target.value,
                )
              }
              maxLength={100}
              autoComplete="given-name"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div>
            <label
              htmlFor="profile-last-name"
              className="block text-sm font-medium"
            >
              Last name
            </label>

            <input
              id="profile-last-name"
              value={form.lastName}
              onChange={(event) =>
                updateField(
                  "lastName",
                  event.target.value,
                )
              }
              maxLength={100}
              autoComplete="family-name"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-6">
          <button
            type="button"
            onClick={resetForm}
            disabled={
              !hasChanges ||
              status === "saving"
            }
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-medium transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw
              aria-hidden="true"
              className="h-4 w-4"
            />
            Reset
          </button>

          <button
            type="submit"
            disabled={
              !hasChanges ||
              status === "saving"
            }
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save
              aria-hidden="true"
              className="h-4 w-4"
            />

            {status === "saving"
              ? "Saving…"
              : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}