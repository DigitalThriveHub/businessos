"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  Copy,
  FilePlus2,
  Globe2,
  KeyRound,
  Plug,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { integrationRequest } from "@/components/integrations/integration-client";
import {
  integrationConnectionSchema,
  gateHDashboardSchema,
  intakeFormSchema,
  integrationsDashboardSchema,
  type GateHDashboard,
  type IntakeForm,
  type IntegrationConnection,
  type IntegrationsDashboard,
} from "@/lib/integrations";

type Props = {
  organisationId: string;
  canManage: boolean;
};

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The integration operation could not be completed.";
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "No events received";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function label(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

function isIntakeProvider(
  provider: IntegrationConnection["provider"],
): boolean {
  return provider === "WORDPRESS" || provider === "GENERIC";
}

function isLegacyProvider(
  provider: IntegrationConnection["provider"],
): boolean {
  return isIntakeProvider(provider) || provider === "STRIPE";
}

export function IntegrationsWorkspace({ organisationId, canManage }: Props) {
  const [dashboard, setDashboard] = useState<IntegrationsDashboard | null>(
    null,
  );
  const [gateH, setGateH] = useState<GateHDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<{
    connectionId: string;
    value: string;
  } | null>(null);
  const [form, setForm] = useState({
    provider: "WORDPRESS" as "WORDPRESS" | "STRIPE" | "GENERIC",
    displayName: "WordPress lead intake",
    externalAccountReference: "",
  });
  const [intakeForm, setIntakeForm] = useState({
    connectionId: "",
    key: "website_enquiry",
    name: "Website enquiry",
    description: "Tell us how we can help and our team will respond.",
    privacyNoticeUrl: "https://example.com/privacy-policy",
    privacyNoticeVersion: "2026-08",
    allowedOrigin: "",
  });

  const refresh = useCallback(
    async (success?: string) => {
      try {
        const query = new URLSearchParams({ organisationId });
        const [result, intake] = await Promise.all([
          integrationRequest(
            `/api/integrations?${query.toString()}`,
            integrationsDashboardSchema,
          ),
          integrationRequest(
            `/api/integrations?${new URLSearchParams({ organisationId, view: "gate-h" }).toString()}`,
            gateHDashboardSchema,
          ),
        ]);
        setDashboard(result);
        setGateH(intake);
        const connection = result.connections.find(
          (entry) =>
            entry.status === "ACTIVE" && isIntakeProvider(entry.provider),
        );
        if (connection) {
          setIntakeForm((current) =>
            current.connectionId
              ? current
              : { ...current, connectionId: connection.id },
          );
        }
        setError(null);
        if (success) setNotice(success);
      } catch (refreshError) {
        setError(message(refreshError));
      } finally {
        setLoading(false);
      }
    },
    [organisationId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function createConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setNotice(null);
    setOneTimeSecret(null);

    try {
      const connection = await integrationRequest(
        "/api/integrations/mutations",
        integrationConnectionSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "connection.create",
            organisationId,
            payload: {
              provider: form.provider,
              displayName: form.displayName,
              ...(form.provider === "STRIPE"
                ? { externalAccountReference: form.externalAccountReference }
                : {}),
            },
          }),
        },
      );
      if (connection.signingSecret) {
        setOneTimeSecret({
          connectionId: connection.id,
          value: connection.signingSecret,
        });
      }
      await refresh("The integration connection was created securely.");
    } catch (createError) {
      setError(message(createError));
    } finally {
      setBusy(null);
    }
  }

  async function createPublicForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("form:create");
    setError(null);
    setNotice(null);
    try {
      await integrationRequest(
        "/api/integrations/mutations",
        intakeFormSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "form.create",
            organisationId,
            payload: {
              connectionId: intakeForm.connectionId,
              key: intakeForm.key,
              name: intakeForm.name,
              description: intakeForm.description,
              privacyNoticeUrl: intakeForm.privacyNoticeUrl,
              privacyNoticeVersion: intakeForm.privacyNoticeVersion,
              allowedOrigins: [
                intakeForm.allowedOrigin || window.location.origin,
              ],
              formSchema: {
                fields: [
                  {
                    name: "firstName",
                    label: "First name",
                    type: "text",
                    required: true,
                  },
                  { name: "lastName", label: "Last name", type: "text" },
                  {
                    name: "email",
                    label: "Email",
                    type: "email",
                    required: true,
                  },
                  { name: "phone", label: "Phone", type: "tel" },
                  {
                    name: "serviceType",
                    label: "Service required",
                    type: "text",
                  },
                  {
                    name: "message",
                    label: "How can we help?",
                    type: "textarea",
                    required: true,
                  },
                  {
                    name: "marketingConsent",
                    label: "I would like relevant updates",
                    type: "checkbox",
                  },
                ],
              },
            },
          }),
        },
      );
      await refresh("The secure public form was created as a draft.");
    } catch (formError) {
      setError(message(formError));
    } finally {
      setBusy(null);
    }
  }

  async function changeFormStatus(intake: IntakeForm) {
    setBusy(`form:${intake.id}`);
    setError(null);
    setNotice(null);
    try {
      await integrationRequest(
        "/api/integrations/mutations",
        intakeFormSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "form.status",
            organisationId,
            formId: intake.id,
            payload: {
              status: intake.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
              expectedVersion: intake.version,
            },
          }),
        },
      );
      await refresh(
        intake.status === "ACTIVE"
          ? "The form was disabled."
          : "The form is live.",
      );
    } catch (formError) {
      setError(message(formError));
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(connection: IntegrationConnection) {
    setBusy(`status:${connection.id}`);
    setError(null);
    setNotice(null);

    try {
      await integrationRequest(
        "/api/integrations/mutations",
        integrationConnectionSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "connection.status",
            organisationId,
            connectionId: connection.id,
            payload: {
              status: connection.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
              expectedVersion: connection.version,
            },
          }),
        },
      );
      await refresh(
        connection.status === "ACTIVE"
          ? "The connection was disabled."
          : "The connection was enabled.",
      );
    } catch (statusError) {
      setError(message(statusError));
    } finally {
      setBusy(null);
    }
  }

  async function rotateSecret(connection: IntegrationConnection) {
    setBusy(`rotate:${connection.id}`);
    setError(null);
    setNotice(null);
    setOneTimeSecret(null);

    try {
      const updated = await integrationRequest(
        "/api/integrations/mutations",
        integrationConnectionSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "connection.rotate-secret",
            organisationId,
            connectionId: connection.id,
            payload: { expectedVersion: connection.version },
          }),
        },
      );
      if (!updated.signingSecret) {
        throw new Error("The rotated secret was not returned.");
      }
      setOneTimeSecret({
        connectionId: updated.id,
        value: updated.signingSecret,
      });
      await refresh("The signing secret was rotated. Update the sender now.");
    } catch (rotateError) {
      setError(message(rotateError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700">
            Controlled connectivity
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Integrations
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Connect external lead sources and Stripe using signed webhooks,
            replay protection, idempotency and tenant-isolated evidence.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || busy !== null}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      ) : null}

      {oneTimeSecret ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 text-amber-800" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-amber-950">
                Copy this signing secret now
              </h2>
              <p className="mt-1 text-sm text-amber-900">
                It is shown once. Store it in the sender&apos;s secret manager,
                never in page code or source control.
              </p>
              <code className="mt-3 block overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-white">
                {oneTimeSecret.value}
              </code>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(oneTimeSecret.value)
                    .then(() => setNotice("Signing secret copied."))
                    .catch(() =>
                      setError("Copy failed. Select the secret manually."),
                    )
                }
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-950"
              >
                <Copy className="h-4 w-4" /> Copy secret
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        {canManage ? (
          <form
            onSubmit={createConnection}
            className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              <h2 className="font-semibold">New connection</h2>
            </div>
            <label className="block text-sm font-medium">
              Provider
              <select
                value={form.provider}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    provider: event.target.value as typeof current.provider,
                  }))
                }
                className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"
              >
                <option value="WORDPRESS">WordPress</option>
                <option value="GENERIC">Generic signed intake</option>
                <option value="STRIPE">Stripe Connect</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Display name
              <input
                required
                minLength={2}
                maxLength={160}
                value={form.displayName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"
              />
            </label>
            {form.provider === "STRIPE" ? (
              <label className="block text-sm font-medium">
                Stripe connected account ID
                <input
                  required
                  placeholder="acct_..."
                  value={form.externalAccountReference}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      externalAccountReference: event.target.value,
                    }))
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"
                />
              </label>
            ) : null}
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              {busy === "create" ? "Creating…" : "Create secure connection"}
            </button>
          </form>
        ) : null}

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Connections</h2>
          {loading ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              Loading controlled connections…
            </p>
          ) : dashboard?.connections.length ? (
            dashboard.connections.map((connection) => (
              <article
                key={connection.id}
                className="rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {connection.provider}
                    </p>
                    <h3 className="mt-1 font-semibold">
                      {connection.displayName}
                    </h3>
                    <p className="mt-2 text-xs text-slate-500">
                      ID {connection.id} · secret version{" "}
                      {connection.secretVersion}
                    </p>
                  </div>
                  <span
                    className={
                      connection.status === "ACTIVE"
                        ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"
                        : "rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                    }
                  >
                    {label(connection.status)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-3 text-sm">
                    <p className="text-slate-500">Processed (24h)</p>
                    <p className="mt-1 font-semibold">
                      {connection.processed24Hours ?? 0}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 text-sm">
                    <p className="text-slate-500">Failed (24h)</p>
                    <p className="mt-1 font-semibold">
                      {connection.failed24Hours ?? 0}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 text-sm">
                    <p className="text-slate-500">Last event</p>
                    <p className="mt-1 font-semibold">
                      {dateTime(connection.lastEventAt)}
                    </p>
                  </div>
                </div>
                {canManage && isLegacyProvider(connection.provider) ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void changeStatus(connection)}
                      disabled={busy !== null}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {connection.status === "ACTIVE" ? "Disable" : "Enable"}
                    </button>
                    {isIntakeProvider(connection.provider) ? (
                      <button
                        type="button"
                        onClick={() => void rotateSecret(connection)}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                      >
                        <RotateCcw className="h-4 w-4" /> Rotate signing secret
                      </button>
                    ) : null}
                  </div>
                ) : !isLegacyProvider(connection.provider) ? (
                  <a
                    href="/communications"
                    className="mt-4 inline-flex rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  >
                    Manage in Communications
                  </a>
                ) : null}
              </article>
            ))
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
              No integration connections are configured.
            </p>
          )}
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Recent integration evidence</h2>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Correlation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dashboard?.recentEvents.length ? (
                dashboard.recentEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-4 py-3">
                      {dateTime(event.receivedAt)}
                    </td>
                    <td className="px-4 py-3">{event.provider}</td>
                    <td className="px-4 py-3">{event.eventType}</td>
                    <td className="px-4 py-3 font-medium">
                      {label(event.status)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {event.correlationId}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No provider events have been recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-5 rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-center gap-2">
          <Globe2 className="h-5 w-5" />
          <h2 className="text-xl font-semibold">
            Universal intake and owned forms
          </h2>
        </div>
        <p className="max-w-4xl text-sm leading-6 text-slate-600">
          Use the signed webhook with WordPress, Elementor, PHP, JavaScript,
          Google Forms Apps Script, Meta Lead Ads, CRMs and custom applications.
          BusinessOS-owned forms can also be embedded as an iframe or linked
          directly.
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-white p-3 text-sm">
            <span className="text-slate-500">Accepted (24h)</span>
            <strong className="mt-1 block text-lg">
              {gateH?.submissionCounts.accepted24Hours ?? 0}
            </strong>
          </div>
          <div className="rounded-xl bg-white p-3 text-sm">
            <span className="text-slate-500">Quarantined</span>
            <strong className="mt-1 block text-lg">
              {gateH?.submissionCounts.quarantined ?? 0}
            </strong>
          </div>
          <div className="rounded-xl bg-white p-3 text-sm">
            <span className="text-slate-500">Unlinked messages</span>
            <strong className="mt-1 block text-lg">
              {gateH?.unlinkedCommunications ?? 0}
            </strong>
          </div>
          <div className="rounded-xl bg-white p-3 text-sm">
            <span className="text-slate-500">Failed deliveries</span>
            <strong className="mt-1 block text-lg">
              {gateH?.failedDeliveries ?? 0}
            </strong>
          </div>
        </div>
        {canManage ? (
          <form
            onSubmit={createPublicForm}
            className="grid gap-4 rounded-2xl bg-white p-5 md:grid-cols-2"
          >
            <div className="md:col-span-2 flex items-center gap-2">
              <FilePlus2 className="h-5 w-5" />
              <h3 className="font-semibold">Create BusinessOS form</h3>
            </div>
            <label className="text-sm font-medium">
              Connection
              <select
                required
                value={intakeForm.connectionId}
                onChange={(event) =>
                  setIntakeForm((current) => ({
                    ...current,
                    connectionId: event.target.value,
                  }))
                }
                className="mt-2 h-11 w-full rounded-xl border px-3"
              >
                <option value="">Select</option>
                {dashboard?.connections
                  .filter(
                    (entry) =>
                      entry.status === "ACTIVE" &&
                      isIntakeProvider(entry.provider),
                  )
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Protected key
              <input
                required
                value={intakeForm.key}
                onChange={(event) =>
                  setIntakeForm((current) => ({
                    ...current,
                    key: event.target.value,
                  }))
                }
                className="mt-2 h-11 w-full rounded-xl border px-3"
              />
            </label>
            <label className="text-sm font-medium">
              Form name
              <input
                required
                value={intakeForm.name}
                onChange={(event) =>
                  setIntakeForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="mt-2 h-11 w-full rounded-xl border px-3"
              />
            </label>
            <label className="text-sm font-medium">
              Allowed website origin (optional)
              <input
                placeholder="https://www.example.com"
                value={intakeForm.allowedOrigin}
                onChange={(event) =>
                  setIntakeForm((current) => ({
                    ...current,
                    allowedOrigin: event.target.value,
                  }))
                }
                className="mt-2 h-11 w-full rounded-xl border px-3"
              />
            </label>
            <label className="text-sm font-medium md:col-span-2">
              Privacy notice URL
              <input
                required
                type="url"
                value={intakeForm.privacyNoticeUrl}
                onChange={(event) =>
                  setIntakeForm((current) => ({
                    ...current,
                    privacyNoticeUrl: event.target.value,
                  }))
                }
                className="mt-2 h-11 w-full rounded-xl border px-3"
              />
            </label>
            <button
              disabled={busy !== null}
              className="h-11 w-fit rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Create draft form
            </button>
          </form>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {gateH?.forms.map((intake) => (
            <article key={intake.id} className="rounded-2xl bg-white p-5">
              <div className="flex justify-between gap-4">
                <div>
                  <h3 className="font-semibold">{intake.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {intake.status} · {intake.key}
                  </p>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => void changeFormStatus(intake)}
                    disabled={busy !== null}
                    className="rounded-xl border px-3 py-2 text-sm font-semibold"
                  >
                    {intake.status === "ACTIVE" ? "Disable" : "Publish"}
                  </button>
                ) : null}
              </div>
              <code className="mt-4 block overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-white">{`/forms/${intake.publicId}`}</code>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
