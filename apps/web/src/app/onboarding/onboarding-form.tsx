"use client";

import {
  useActionState,
  useState,
} from "react";

import {
  createOrganisation,
  type OnboardingActionState,
} from "./actions";

type OnboardingFormProps = {
  email: string;
  initialDisplayName?: string;
  initialFirstName?: string;
  initialLastName?: string;
};

const initialState: OnboardingActionState = {
  status: "idle",
};

function createSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

function FieldError({
  id,
  messages,
}: {
  id: string;
  messages?: string[];
}) {
  if (!messages?.length) {
    return null;
  }

  return (
    <p id={id} className="mt-1 text-sm text-red-700">
      {messages[0]}
    </p>
  );
}

export function OnboardingForm({
  email,
  initialDisplayName = "",
  initialFirstName = "",
  initialLastName = "",
}: OnboardingFormProps) {
  const [state, formAction, isPending] = useActionState(
    createOrganisation,
    initialState,
  );

  const [organisationName, setOrganisationName] =
    useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <form action={formAction} className="space-y-8">
      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {state.message}
        </div>
      ) : null}

      <fieldset
        disabled={isPending}
        className="space-y-6 disabled:opacity-70"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Organisation details
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Create the secure workspace that your authorised
            team members will use.
          </p>
        </div>

        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-slate-800"
          >
            Organisation name
          </label>

          <input
            id="name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={200}
            autoComplete="organization"
            value={organisationName}
            aria-invalid={Boolean(state.fieldErrors?.name)}
            aria-describedby={
              state.fieldErrors?.name
                ? "name-error"
                : undefined
            }
            onChange={(event) => {
              const nextName = event.target.value;
              setOrganisationName(nextName);

              if (!slugEdited) {
                setSlug(createSlug(nextName));
              }
            }}
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
            placeholder="Example Legal Services"
          />

          <FieldError
            id="name-error"
            messages={state.fieldErrors?.name}
          />
        </div>

        <div>
          <label
            htmlFor="slug"
            className="block text-sm font-medium text-slate-800"
          >
            Organisation URL
          </label>

          <div className="mt-2 flex overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:border-slate-950 focus-within:ring-2 focus-within:ring-slate-950/10">
            <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
              businessos/
            </span>

            <input
              id="slug"
              name="slug"
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={slug}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              aria-invalid={Boolean(state.fieldErrors?.slug)}
              aria-describedby={
                state.fieldErrors?.slug
                  ? "slug-error"
                  : "slug-help"
              }
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(createSlug(event.target.value));
              }}
              className="min-w-0 flex-1 px-4 py-3 text-slate-950 outline-none"
              placeholder="example-legal-services"
            />
          </div>

          <p
            id="slug-help"
            className="mt-1 text-xs text-slate-500"
          >
            Use lowercase letters, numbers and hyphens.
          </p>

          <FieldError
            id="slug-error"
            messages={state.fieldErrors?.slug}
          />
        </div>

        <div>
          <label
            htmlFor="legalName"
            className="block text-sm font-medium text-slate-800"
          >
            Registered legal name{" "}
            <span className="font-normal text-slate-500">
              (optional)
            </span>
          </label>

          <input
            id="legalName"
            name="legalName"
            type="text"
            maxLength={250}
            aria-invalid={Boolean(
              state.fieldErrors?.legalName,
            )}
            aria-describedby={
              state.fieldErrors?.legalName
                ? "legal-name-error"
                : undefined
            }
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
            placeholder="Example Legal Services Limited"
          />

          <FieldError
            id="legal-name-error"
            messages={state.fieldErrors?.legalName}
          />
        </div>

        <div className="border-t border-slate-200 pt-7">
          <h2 className="text-lg font-semibold text-slate-950">
            Organisation owner
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Your authenticated account will become the first
            organisation owner.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-800">
            Owner email
          </label>

          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {email}
          </div>

          <p className="mt-1 text-xs text-slate-500">
            This is securely taken from your authenticated account
            and cannot be changed here.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="ownerFirstName"
              className="block text-sm font-medium text-slate-800"
            >
              First name
            </label>

            <input
              id="ownerFirstName"
              name="ownerFirstName"
              type="text"
              maxLength={100}
              autoComplete="given-name"
              defaultValue={initialFirstName}
              aria-invalid={Boolean(
                state.fieldErrors?.ownerFirstName,
              )}
              className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
            />

            <FieldError
              id="owner-first-name-error"
              messages={state.fieldErrors?.ownerFirstName}
            />
          </div>

          <div>
            <label
              htmlFor="ownerLastName"
              className="block text-sm font-medium text-slate-800"
            >
              Last name
            </label>

            <input
              id="ownerLastName"
              name="ownerLastName"
              type="text"
              maxLength={100}
              autoComplete="family-name"
              defaultValue={initialLastName}
              aria-invalid={Boolean(
                state.fieldErrors?.ownerLastName,
              )}
              className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
            />

            <FieldError
              id="owner-last-name-error"
              messages={state.fieldErrors?.ownerLastName}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="ownerDisplayName"
            className="block text-sm font-medium text-slate-800"
          >
            Display name
          </label>

          <input
            id="ownerDisplayName"
            name="ownerDisplayName"
            type="text"
            maxLength={200}
            autoComplete="name"
            defaultValue={initialDisplayName}
            aria-invalid={Boolean(
              state.fieldErrors?.ownerDisplayName,
            )}
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          />

          <FieldError
            id="owner-display-name-error"
            messages={state.fieldErrors?.ownerDisplayName}
          />
        </div>

        <div>
          <label
            htmlFor="ownerJobTitle"
            className="block text-sm font-medium text-slate-800"
          >
            Job title{" "}
            <span className="font-normal text-slate-500">
              (optional)
            </span>
          </label>

          <input
            id="ownerJobTitle"
            name="ownerJobTitle"
            type="text"
            maxLength={160}
            autoComplete="organization-title"
            aria-invalid={Boolean(
              state.fieldErrors?.ownerJobTitle,
            )}
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
            placeholder="Managing Director"
          />

          <FieldError
            id="owner-job-title-error"
            messages={state.fieldErrors?.ownerJobTitle}
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? "Creating secure workspace…"
            : "Create organisation"}
        </button>
      </fieldset>
    </form>
  );
}