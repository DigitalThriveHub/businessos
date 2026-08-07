"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ENQUIRY_PRIORITIES,
  ENQUIRY_PRIORITY_LABELS,
  ENQUIRY_STATUSES,
  ENQUIRY_STATUS_LABELS,
  type Enquiry,
  type EnquiryListResponse,
  type EnquiryPriority,
  type EnquiryStatus,
} from "@/lib/enquiries";

type ApiMessage = {
  message?: string;
};

type CurrentUserResponse = {
  organisationId?: string;
  activeOrganisationId?: string;
  organisation?: {
    id?: string;
  };
  membership?: {
    organisationId?: string;
  };
  memberships?: Array<{
    organisationId?: string;
    status?: string;
    organisation?: {
      id?: string;
      status?: string;
    };
  }>;
};

type EnquiryFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  serviceType: string;
  source: string;
  message: string;
  status: EnquiryStatus;
  priority: EnquiryPriority;
  nextFollowUpAt: string;
};

const EMPTY_FORM: EnquiryFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  country: "",
  serviceType: "",
  source: "",
  message: "",
  status: "NEW",
  priority: "NORMAL",
  nextFollowUpAt: "",
};

const PAGE_SIZE = 20;

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function resolveOrganisationId(user: CurrentUserResponse): string | null {
  const directCandidates = [
    user.activeOrganisationId,
    user.organisationId,
    user.organisation?.id,
    user.membership?.organisationId,
  ];

  const directMatch = directCandidates.find(isUuid);

  if (directMatch) {
    return directMatch;
  }

  const activeMembership = user.memberships?.find(
    (membership) =>
      membership.status === "ACTIVE" &&
      membership.organisation?.status !== "INACTIVE" &&
      (isUuid(membership.organisationId) ||
        isUuid(membership.organisation?.id)),
  );

  const activeId =
    activeMembership?.organisationId ??
    activeMembership?.organisation?.id;

  if (isUuid(activeId)) {
    return activeId;
  }

  const firstMembership = user.memberships?.find(
    (membership) =>
      isUuid(membership.organisationId) ||
      isUuid(membership.organisation?.id),
  );

  const firstId =
    firstMembership?.organisationId ??
    firstMembership?.organisation?.id;

  return isUuid(firstId) ? firstId : null;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiMessage;

    if (body.message) {
      return body.message;
    }
  } catch {
    // Do not expose malformed or sensitive upstream responses.
  }

  if (response.status === 401) {
    return "Your secure session has expired. Please sign in again.";
  }

  if (response.status === 403) {
    return "You do not have permission to perform this action.";
  }

  if (response.status === 404) {
    return "The requested enquiry could not be found.";
  }

  return "The request could not be completed. Please try again.";
}

function toDateTimeLocal(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoDate(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function enquiryToForm(enquiry: Enquiry): EnquiryFormState {
  return {
    firstName: enquiry.firstName,
    lastName: enquiry.lastName ?? "",
    email: enquiry.email ?? "",
    phone: enquiry.phone ?? "",
    country: enquiry.country ?? "",
    serviceType: enquiry.serviceType ?? "",
    source: enquiry.source ?? "",
    message: enquiry.message ?? "",
    status: enquiry.status,
    priority: enquiry.priority,
    nextFollowUpAt: toDateTimeLocal(enquiry.nextFollowUpAt),
  };
}

function priorityClass(priority: EnquiryPriority): string {
  switch (priority) {
    case "URGENT":
      return "bg-red-100 text-red-800";
    case "HIGH":
      return "bg-orange-100 text-orange-800";
    case "LOW":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-blue-100 text-blue-800";
  }
}

function statusClass(status: EnquiryStatus): string {
  switch (status) {
    case "NEW":
      return "bg-violet-100 text-violet-800";
    case "CONTACTED":
      return "bg-blue-100 text-blue-800";
    case "QUALIFIED":
      return "bg-amber-100 text-amber-800";
    case "CONSULTATION_BOOKED":
      return "bg-cyan-100 text-cyan-800";
    case "CONVERTED":
      return "bg-emerald-100 text-emerald-800";
    case "SPAM":
      return "bg-red-100 text-red-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function EnquiriesWorkspace() {
  const [organisationId, setOrganisationId] = useState<string | null>(null);
  const [items, setItems] = useState<Enquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<EnquiryStatus | "">("");
  const [priority, setPriority] = useState<EnquiryPriority | "">("");

  const [initialising, setInitialising] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEnquiry, setSelectedEnquiry] =
    useState<Enquiry | null>(null);
  const [form, setForm] = useState<EnquiryFormState>(EMPTY_FORM);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    async function initialise() {
      setInitialising(true);
      setError(null);

      try {
        const response = await fetch("/api/auth/me", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const currentUser =
          (await response.json()) as CurrentUserResponse;

        const resolvedOrganisationId =
          resolveOrganisationId(currentUser);

        if (!resolvedOrganisationId) {
          throw new Error(
            "No active organisation is available for this account.",
          );
        }

        if (!cancelled) {
          setOrganisationId(resolvedOrganisationId);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Your account could not be verified.",
          );
        }
      } finally {
        if (!cancelled) {
          setInitialising(false);
        }
      }
    }

    void initialise();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadEnquiries = useCallback(
    async (signal?: AbortSignal) => {
      if (!organisationId) {
        return;
      }

      setLoading(true);
      setError(null);

      const query = new URLSearchParams({
        organisationId,
        page: String(page),
        limit: String(PAGE_SIZE),
      });

      if (search) {
        query.set("search", search);
      }

      if (status) {
        query.set("status", status);
      }

      if (priority) {
        query.set("priority", priority);
      }

      try {
        const response = await fetch(
          `/api/enquiries?${query.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const data = (await response.json()) as EnquiryListResponse;

        setItems(data.items);
        setTotal(data.pagination.total);
        setTotalPages(data.pagination.totalPages);
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Enquiries could not be loaded.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [organisationId, page, priority, search, status],
  );

 useEffect(() => {
  const controller = new AbortController();

  const timeoutId = window.setTimeout(() => {
    void loadEnquiries(controller.signal);
  }, 0);

  return () => {
    window.clearTimeout(timeoutId);
    controller.abort();
  };
}, [loadEnquiries]);

  const visibleFrom = useMemo(() => {
    if (total === 0) {
      return 0;
    }

    return (page - 1) * PAGE_SIZE + 1;
  }, [page, total]);

  const visibleTo = Math.min(page * PAGE_SIZE, total);

  function openCreateEditor() {
    setSelectedEnquiry(null);
    setForm(EMPTY_FORM);
    setError(null);
    setNotice(null);
    setEditorOpen(true);
  }

  function openEditEditor(enquiry: Enquiry) {
    setSelectedEnquiry(enquiry);
    setForm(enquiryToForm(enquiry));
    setError(null);
    setNotice(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (saving) {
      return;
    }

    setEditorOpen(false);
    setSelectedEnquiry(null);
    setForm(EMPTY_FORM);
  }

  function updateField<K extends keyof EnquiryFormState>(
    field: K,
    value: EnquiryFormState[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function submitEnquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organisationId || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      country: form.country.trim() || undefined,
      serviceType: form.serviceType.trim() || undefined,
      source: form.source.trim() || undefined,
      message: form.message.trim() || undefined,
      status: form.status,
      priority: form.priority,
      nextFollowUpAt: toIsoDate(form.nextFollowUpAt),
    };

    const editing = selectedEnquiry !== null;
    const endpoint = editing
      ? `/api/enquiries/${encodeURIComponent(
          selectedEnquiry.id,
        )}?organisationId=${encodeURIComponent(organisationId)}`
      : "/api/enquiries";

    try {
      const response = await fetch(endpoint, {
        method: editing ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          editing
            ? payload
            : {
                organisationId,
                ...payload,
              },
        ),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      setEditorOpen(false);
      setSelectedEnquiry(null);
      setForm(EMPTY_FORM);
      setNotice(
        editing
          ? "Enquiry updated successfully."
          : "Enquiry created successfully.",
      );

      if (!editing && page !== 1) {
        setPage(1);
      } else {
        await loadEnquiries();
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The enquiry could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteEnquiry(enquiry: Enquiry) {
    if (!organisationId || deletingId) {
      return;
    }

    const confirmed = window.confirm(
      `Delete the enquiry for ${enquiry.firstName}${
        enquiry.lastName ? ` ${enquiry.lastName}` : ""
      }?\n\nThis action should only be used where deletion is permitted by your organisation's retention policy.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(enquiry.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/enquiries/${encodeURIComponent(
          enquiry.id,
        )}?organisationId=${encodeURIComponent(organisationId)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      setNotice("Enquiry deleted successfully.");

      if (items.length === 1 && page > 1) {
        setPage((current) => current - 1);
      } else {
        await loadEnquiries();
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The enquiry could not be deleted.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (initialising) {
    return (
      <section
        className="mx-auto max-w-7xl p-6 lg:p-8"
        aria-busy="true"
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm text-slate-600">
            Verifying your secure workspace…
          </p>
        </div>
      </section>
    );
  }

  if (!organisationId) {
    return (
      <section className="mx-auto max-w-7xl p-6 lg:p-8">
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
        >
          {error ?? "No active organisation is available."}
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            Enquiries
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage leads, follow-ups and conversion progress.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateEditor}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2"
        >
          Add enquiry
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_220px_180px]">
        <label className="block">
          <span className="sr-only">Search enquiries</span>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name, email, phone or service"
            maxLength={200}
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          />
        </label>

        <label className="block">
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value as EnquiryStatus | "");
            }}
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          >
            <option value="">All statuses</option>
            {ENQUIRY_STATUSES.map((option) => (
              <option key={option} value={option}>
                {ENQUIRY_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">Filter by priority</span>
          <select
            value={priority}
            onChange={(event) => {
              setPage(1);
              setPriority(event.target.value as EnquiryPriority | "");
            }}
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          >
            <option value="">All priorities</option>
            {ENQUIRY_PRIORITIES.map((option) => (
              <option key={option} value={option}>
                {ENQUIRY_PRIORITY_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Contact
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Service
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Priority
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Follow-up
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading && items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-slate-500"
                  >
                    Loading enquiries…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center"
                  >
                    <p className="font-medium text-slate-900">
                      No enquiries found
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Change the filters or add your first enquiry.
                    </p>
                  </td>
                </tr>
              ) : (
                items.map((enquiry) => (
                  <tr
                    key={enquiry.id}
                    className="transition hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-4 py-4">
                      <p className="font-medium text-slate-950">
                        {enquiry.firstName} {enquiry.lastName ?? ""}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {enquiry.email ??
                          enquiry.phone ??
                          "No contact details"}
                      </p>
                    </td>

                    <td className="px-4 py-4 text-sm text-slate-700">
                      {enquiry.serviceType ?? "—"}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(
                          enquiry.status,
                        )}`}
                      >
                        {ENQUIRY_STATUS_LABELS[enquiry.status]}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${priorityClass(
                          enquiry.priority,
                        )}`}
                      >
                        {ENQUIRY_PRIORITY_LABELS[enquiry.priority]}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-600">
                      {formatDate(enquiry.nextFollowUpAt)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditEditor(enquiry)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-950"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          disabled={deletingId === enquiry.id}
                          onClick={() => void deleteEnquiry(enquiry)}
                          className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === enquiry.id
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-600">
            Showing {visibleFrom}–{visibleTo} of {total}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>

            <button
              type="button"
              disabled={page >= totalPages || totalPages === 0 || loading}
              onClick={() =>
                setPage((current) =>
                  Math.min(totalPages, current + 1),
                )
              }
              className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEditor();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="enquiry-editor-title"
            className="max-h-[95vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2
                  id="enquiry-editor-title"
                  className="text-lg font-semibold text-slate-950"
                >
                  {selectedEnquiry ? "Edit enquiry" : "Add enquiry"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Only collect information required for managing the enquiry.
                </p>
              </div>

              <button
                type="button"
                onClick={closeEditor}
                disabled={saving}
                aria-label="Close enquiry editor"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <form onSubmit={submitEnquiry} className="p-5 sm:p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="First name" required>
                  <input
                    required
                    autoFocus
                    maxLength={100}
                    autoComplete="given-name"
                    value={form.firstName}
                    onChange={(event) =>
                      updateField("firstName", event.target.value)
                    }
                    className="form-input"
                  />
                </FormField>

                <FormField label="Last name">
                  <input
                    maxLength={100}
                    autoComplete="family-name"
                    value={form.lastName}
                    onChange={(event) =>
                      updateField("lastName", event.target.value)
                    }
                    className="form-input"
                  />
                </FormField>

                <FormField label="Email">
                  <input
                    type="email"
                    maxLength={320}
                    autoComplete="email"
                    value={form.email}
                    onChange={(event) =>
                      updateField("email", event.target.value)
                    }
                    className="form-input"
                  />
                </FormField>

                <FormField label="Phone">
                  <input
                    type="tel"
                    maxLength={50}
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(event) =>
                      updateField("phone", event.target.value)
                    }
                    className="form-input"
                  />
                </FormField>

                <FormField label="Country">
                  <input
                    maxLength={100}
                    autoComplete="country-name"
                    value={form.country}
                    onChange={(event) =>
                      updateField("country", event.target.value)
                    }
                    className="form-input"
                  />
                </FormField>

                <FormField label="Service type">
                  <input
                    maxLength={160}
                    value={form.serviceType}
                    onChange={(event) =>
                      updateField("serviceType", event.target.value)
                    }
                    className="form-input"
                  />
                </FormField>

                <FormField label="Source">
                  <input
                    maxLength={100}
                    placeholder="Website, referral, telephone…"
                    value={form.source}
                    onChange={(event) =>
                      updateField("source", event.target.value)
                    }
                    className="form-input"
                  />
                </FormField>

                <FormField label="Next follow-up">
                  <input
                    type="datetime-local"
                    value={form.nextFollowUpAt}
                    onChange={(event) =>
                      updateField("nextFollowUpAt", event.target.value)
                    }
                    className="form-input"
                  />
                </FormField>

                <FormField label="Status">
                  <select
                    value={form.status}
                    onChange={(event) =>
                      updateField(
                        "status",
                        event.target.value as EnquiryStatus,
                      )
                    }
                    className="form-input"
                  >
                    {ENQUIRY_STATUSES.map((option) => (
                      <option key={option} value={option}>
                        {ENQUIRY_STATUS_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Priority">
                  <select
                    value={form.priority}
                    onChange={(event) =>
                      updateField(
                        "priority",
                        event.target.value as EnquiryPriority,
                      )
                    }
                    className="form-input"
                  >
                    {ENQUIRY_PRIORITIES.map((option) => (
                      <option key={option} value={option}>
                        {ENQUIRY_PRIORITY_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </FormField>

                <div className="sm:col-span-2">
                  <FormField label="Message or notes">
                    <textarea
                      rows={5}
                      maxLength={10_000}
                      value={form.message}
                      onChange={(event) =>
                        updateField("message", event.target.value)
                      }
                      className="form-input resize-y"
                    />
                  </FormField>
                </div>
              </div>

              <div className="mt-7 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeEditor}
                  disabled={saving}
                  className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving || !form.firstName.trim()}
                  className="min-h-11 rounded-lg bg-slate-950 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving
                    ? "Saving…"
                    : selectedEnquiry
                      ? "Save changes"
                      : "Create enquiry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.form-input) {
          min-height: 44px;
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(203 213 225);
          background: white;
          padding: 0.625rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(15 23 42);
          outline: none;
          transition:
            border-color 150ms,
            box-shadow 150ms;
        }

        :global(.form-input:focus) {
          border-color: rgb(15 23 42);
          box-shadow: 0 0 0 3px rgb(15 23 42 / 0.1);
        }
      `}</style>
    </section>
  );
}

function FormField({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
    </label>
  );
}