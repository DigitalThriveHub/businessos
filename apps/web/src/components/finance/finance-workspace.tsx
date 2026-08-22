"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Banknote,
  CheckCircle2,
  FilePlus2,
  Landmark,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import type { ZodType } from "zod";

import { financeRequest } from "@/components/finance/finance-client";
import {
  financeDashboardSchema,
  financeDocumentSchema,
  financePaymentSchema,
  financeSettingsSchema,
  type FinanceDashboard,
  type FinanceDocument,
} from "@/lib/finance";

type Props = {
  organisationId: string;
  canManageSettings: boolean;
  canCreate: boolean;
  canIssue: boolean;
  canVoid: boolean;
  canRecordPayments: boolean;
  canReadLedger: boolean;
};

type View = "invoices" | "payments" | "settings" | "ledger";
type DraftLine = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxCategory: "STANDARD" | "REDUCED" | "ZERO" | "EXEMPT" | "OUTSIDE_SCOPE";
  vatRate: string;
};

const emptyLine = (id = "initial-line"): DraftLine => ({
  id,
  description: "",
  quantity: "1",
  unitPrice: "",
  taxCategory: "STANDARD",
  vatRate: "20",
});

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The finance operation could not be completed.";
}

function money(value: string, currency = "GBP"): string {
  const minor = Number(value);
  if (!Number.isSafeInteger(minor)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(minor / 100);
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

function poundsToMinor(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new Error("Enter a valid amount with no more than two decimals.");
  }
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error("Enter a positive finance amount.");
  }
  return result;
}

function quantityToMilli(value: string): number {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim())) {
    throw new Error("Quantity can use no more than three decimals.");
  }
  const result = Math.round(Number(value) * 1000);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error("Enter a positive quantity.");
  }
  return result;
}

function Badge({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
      {statusLabel(value)}
    </span>
  );
}

export function FinanceWorkspace({
  organisationId,
  canManageSettings,
  canCreate,
  canIssue,
  canVoid,
  canRecordPayments,
  canReadLedger,
}: Props) {
  const [view, setView] = useState<View>("invoices");
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invoice, setInvoice] = useState({
    clientId: "",
    matterId: "",
    reference: "",
    dueDate: "",
    notes: "",
  });
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [payment, setPayment] = useState({
    documentId: "",
    amount: "",
    method: "BANK_TRANSFER",
    reference: "",
  });
  const [settings, setSettings] = useState({
    legalName: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    countryCode: "GB",
    vatScheme: "NOT_REGISTERED",
    vatRegistrationNumber: "",
    baseCurrency: "GBP",
    invoicePrefix: "INV",
    creditNotePrefix: "CRN",
    paymentPrefix: "PAY",
    paymentTermsDays: "14",
    paymentInstructions: "",
  });

  const applySettings = useCallback((data: FinanceDashboard["settings"]) => {
    setSettings({
      legalName: data.legalName ?? "",
      addressLine1: data.addressLine1 ?? "",
      addressLine2: data.addressLine2 ?? "",
      city: data.city ?? "",
      region: data.region ?? "",
      postalCode: data.postalCode ?? "",
      countryCode: data.countryCode,
      vatScheme: data.vatScheme,
      vatRegistrationNumber: data.vatRegistrationNumber ?? "",
      baseCurrency: data.baseCurrency,
      invoicePrefix: data.invoicePrefix,
      creditNotePrefix: data.creditNotePrefix,
      paymentPrefix: data.paymentPrefix,
      paymentTermsDays: String(data.paymentTermsDays),
      paymentInstructions: data.paymentInstructions ?? "",
    });
  }, []);

  const refresh = useCallback(
    async (success?: string) => {
      try {
        const query = new URLSearchParams({ organisationId });
        const result = await financeRequest(
          `/api/finance?${query.toString()}`,
          financeDashboardSchema,
        );
        setDashboard(result);
        applySettings(result.settings);
        setError(null);
        if (success) setNotice(success);
      } catch (refreshError) {
        setError(errorMessage(refreshError));
      } finally {
        setLoading(false);
      }
    },
    [applySettings, organisationId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const selectedClientMatters = useMemo(
    () =>
      dashboard?.matters.filter(
        (matter) => matter.clientId === invoice.clientId,
      ) ?? [],
    [dashboard?.matters, invoice.clientId],
  );
  const openInvoices = useMemo(
    () =>
      dashboard?.documents.filter(
        (document) =>
          document.documentType === "INVOICE" &&
          ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(document.status) &&
          document.balanceMinor !== "0",
      ) ?? [],
    [dashboard?.documents],
  );
  const settingsComplete = Boolean(
    dashboard?.settings.legalName &&
    dashboard.settings.addressLine1 &&
    dashboard.settings.city &&
    dashboard.settings.postalCode,
  );

  async function mutate<T>(
    key: string,
    schema: ZodType<T>,
    body: unknown,
    success: string,
  ): Promise<T | null> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await financeRequest("/api/finance/mutations", schema, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refresh(success);
      return result;
    } catch (mutationError) {
      setError(errorMessage(mutationError));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await mutate(
        "create",
        financeDocumentSchema,
        {
          operation: "document.create",
          organisationId,
          payload: {
            clientId: invoice.clientId,
            ...(invoice.matterId ? { matterId: invoice.matterId } : {}),
            documentType: "INVOICE",
            currencyCode: dashboard?.settings.baseCurrency ?? "GBP",
            ...(invoice.dueDate ? { dueDate: invoice.dueDate } : {}),
            reference: invoice.reference || null,
            notes: invoice.notes || null,
            clientVisible: true,
            lines: lines.map((line) => ({
              description: line.description,
              quantityMilli: quantityToMilli(line.quantity),
              unitAmountMinor: poundsToMinor(line.unitPrice),
              taxCategory: line.taxCategory,
              vatRateBasisPoints: Math.round(Number(line.vatRate) * 100),
            })),
          },
        },
        "Draft invoice created.",
      );
      if (result) {
        setInvoice({
          clientId: "",
          matterId: "",
          reference: "",
          dueDate: "",
          notes: "",
        });
        setLines([emptyLine()]);
      }
    } catch (validationError) {
      setError(errorMessage(validationError));
    }
  }

  async function issueDocument(document: FinanceDocument) {
    await mutate(
      `issue:${document.id}`,
      financeDocumentSchema,
      {
        operation: "document.issue",
        organisationId,
        documentId: document.id,
        payload: { expectedVersion: document.version },
      },
      "Finance document issued and posted to the ledger.",
    );
  }

  async function voidDocument(document: FinanceDocument) {
    const reason = window.prompt(
      `Reason for voiding ${document.documentNumber ?? "this draft"}:`,
    );
    if (!reason?.trim()) return;
    await mutate(
      `void:${document.id}`,
      financeDocumentSchema,
      {
        operation: "document.void",
        organisationId,
        documentId: document.id,
        payload: { expectedVersion: document.version, reason },
      },
      "Finance document voided with audit evidence.",
    );
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const document = openInvoices.find(
      (item) => item.id === payment.documentId,
    );
    if (!document) return;
    try {
      const amountMinor = poundsToMinor(payment.amount);
      const result = await mutate(
        "payment",
        financePaymentSchema,
        {
          operation: "payment.record",
          organisationId,
          payload: {
            clientId: document.clientId,
            paymentType: "RECEIPT",
            method: payment.method,
            currencyCode: document.currencyCode,
            amountMinor,
            occurredAt: new Date().toISOString(),
            reference: payment.reference || null,
            idempotencyKey: `finance-payment/${crypto.randomUUID()}`,
            allocations: [{ documentId: document.id, amountMinor }],
          },
        },
        "Payment recorded, allocated and posted to the ledger.",
      );
      if (result) {
        setPayment({
          documentId: "",
          amount: "",
          method: "BANK_TRANSFER",
          reference: "",
        });
      }
    } catch (validationError) {
      setError(errorMessage(validationError));
    }
  }

  async function updateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard) return;
    await mutate(
      "settings",
      financeSettingsSchema,
      {
        operation: "settings.update",
        organisationId,
        payload: {
          expectedVersion: dashboard.settings.version,
          legalName: settings.legalName || null,
          addressLine1: settings.addressLine1 || null,
          addressLine2: settings.addressLine2 || null,
          city: settings.city || null,
          region: settings.region || null,
          postalCode: settings.postalCode || null,
          countryCode: settings.countryCode,
          vatScheme: settings.vatScheme,
          vatRegistrationNumber:
            settings.vatScheme === "NOT_REGISTERED"
              ? null
              : settings.vatRegistrationNumber || null,
          baseCurrency: settings.baseCurrency,
          invoicePrefix: settings.invoicePrefix,
          creditNotePrefix: settings.creditNotePrefix,
          paymentPrefix: settings.paymentPrefix,
          paymentTermsDays: Number(settings.paymentTermsDays),
          paymentInstructions: settings.paymentInstructions || null,
        },
      },
      "Finance settings saved.",
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700">
            Controlled finance
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Finance</h1>
          <p className="mt-2 text-sm text-slate-600">
            VAT-aware invoices, payment allocation and immutable accounting
            evidence.
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
      </div>

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
      {!settingsComplete && !loading ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Complete the legal invoice address in Finance settings before issuing
          an invoice.
        </p>
      ) : null}

      {dashboard ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <ReceiptText className="h-5 w-5 text-blue-700" />
            <p className="mt-3 text-2xl font-bold">
              {dashboard.summary.openCount}
            </p>
            <p className="text-sm text-slate-600">open invoices</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <Banknote className="h-5 w-5 text-emerald-700" />
            <p className="mt-3 text-2xl font-bold">
              {money(
                dashboard.summary.receivableMinor,
                dashboard.settings.baseCurrency,
              )}
            </p>
            <p className="text-sm text-slate-600">accounts receivable</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <CheckCircle2 className="h-5 w-5 text-violet-700" />
            <p className="mt-3 text-2xl font-bold">
              {money(
                dashboard.summary.received30DaysMinor,
                dashboard.settings.baseCurrency,
              )}
            </p>
            <p className="text-sm text-slate-600">received in 30 days</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <Landmark className="h-5 w-5 text-amber-700" />
            <p className="mt-3 text-2xl font-bold">
              {dashboard.summary.overdueCount}
            </p>
            <p className="text-sm text-slate-600">overdue invoices</p>
          </div>
        </section>
      ) : null}

      <nav className="flex gap-2 overflow-x-auto" aria-label="Finance sections">
        {(
          [
            ["invoices", "Invoices"],
            ["payments", "Payments"],
            ["settings", "Settings"],
            ["ledger", "Ledger"],
          ] as const
        ).map(([key, label]) =>
          key !== "ledger" || canReadLedger ? (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={
                view === key
                  ? "rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
                  : "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold"
              }
            >
              {label}
            </button>
          ) : null,
        )}
      </nav>

      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          Loading protected finance records…
        </p>
      ) : null}

      {dashboard && view === "invoices" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Invoices and credit notes</h2>
            {dashboard.documents.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
                No finance documents yet.
              </p>
            ) : (
              dashboard.documents.map((document) => (
                <article
                  key={document.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {document.documentNumber ?? "Draft"} ·{" "}
                        {document.clientNumber}
                      </p>
                      <h3 className="mt-1 font-semibold">
                        {document.clientName}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {document.reference ||
                          document.matterNumber ||
                          "General billing"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">
                        {money(document.totalMinor, document.currencyCode)}
                      </p>
                      <Badge value={document.status} />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {document.status === "DRAFT" && canIssue ? (
                      <button
                        type="button"
                        onClick={() => void issueDocument(document)}
                        disabled={busy !== null || !settingsComplete}
                        className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        Issue and post
                      </button>
                    ) : null}
                    {canVoid &&
                    ["DRAFT", "ISSUED", "OVERDUE"].includes(document.status) ? (
                      <button
                        type="button"
                        onClick={() => void voidDocument(document)}
                        disabled={busy !== null}
                        className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50"
                      >
                        Void
                      </button>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </section>

          {canCreate ? (
            <form
              onSubmit={createInvoice}
              className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="flex items-center gap-2">
                <FilePlus2 className="h-5 w-5" />
                <h2 className="font-semibold">Create draft invoice</h2>
              </div>
              <label className="block text-sm font-medium">
                Client
                <select
                  required
                  value={invoice.clientId}
                  onChange={(event) =>
                    setInvoice((current) => ({
                      ...current,
                      clientId: event.target.value,
                      matterId: "",
                    }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3"
                >
                  <option value="">Select client</option>
                  {dashboard.clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.clientNumber} · {client.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Matter
                <select
                  value={invoice.matterId}
                  onChange={(event) =>
                    setInvoice((current) => ({
                      ...current,
                      matterId: event.target.value,
                    }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3"
                >
                  <option value="">General client invoice</option>
                  {selectedClientMatters.map((matter) => (
                    <option key={matter.id} value={matter.id}>
                      {matter.matterNumber} · {matter.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Reference
                  <input
                    maxLength={120}
                    value={invoice.reference}
                    onChange={(event) =>
                      setInvoice((current) => ({
                        ...current,
                        reference: event.target.value,
                      }))
                    }
                    className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3"
                  />
                </label>
                <label className="text-sm font-medium">
                  Due date
                  <input
                    type="date"
                    value={invoice.dueDate}
                    onChange={(event) =>
                      setInvoice((current) => ({
                        ...current,
                        dueDate: event.target.value,
                      }))
                    }
                    className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3"
                  />
                </label>
              </div>
              <div className="space-y-3">
                {lines.map((line, index) => (
                  <fieldset
                    key={line.id}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <legend className="text-sm font-semibold">
                        Line {index + 1}
                      </legend>
                      {lines.length > 1 ? (
                        <button
                          type="button"
                          aria-label={`Remove line ${index + 1}`}
                          onClick={() =>
                            setLines((current) =>
                              current.filter((item) => item.id !== line.id),
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4 text-red-700" />
                        </button>
                      ) : null}
                    </div>
                    <input
                      required
                      placeholder="Service description"
                      maxLength={500}
                      value={line.description}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((item) =>
                            item.id === line.id
                              ? { ...item, description: event.target.value }
                              : item,
                          ),
                        )
                      }
                      className="mt-3 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    />
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <input
                        required
                        aria-label={`Line ${index + 1} quantity`}
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((item) =>
                              item.id === line.id
                                ? { ...item, quantity: event.target.value }
                                : item,
                            ),
                          )
                        }
                        className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                      />
                      <input
                        required
                        aria-label={`Line ${index + 1} unit price`}
                        placeholder="Price £"
                        inputMode="decimal"
                        value={line.unitPrice}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((item) =>
                              item.id === line.id
                                ? { ...item, unitPrice: event.target.value }
                                : item,
                            ),
                          )
                        }
                        className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                      />
                      <select
                        aria-label={`Line ${index + 1} tax category`}
                        value={line.taxCategory}
                        onChange={(event) => {
                          const taxCategory = event.target
                            .value as DraftLine["taxCategory"];
                          setLines((current) =>
                            current.map((item) =>
                              item.id === line.id
                                ? {
                                    ...item,
                                    taxCategory,
                                    vatRate: [
                                      "ZERO",
                                      "EXEMPT",
                                      "OUTSIDE_SCOPE",
                                    ].includes(taxCategory)
                                      ? "0"
                                      : item.vatRate,
                                  }
                                : item,
                            ),
                          );
                        }}
                        className="h-10 rounded-lg border border-slate-300 px-2 text-sm"
                      >
                        <option value="STANDARD">Standard VAT</option>
                        <option value="REDUCED">Reduced VAT</option>
                        <option value="ZERO">Zero-rated</option>
                        <option value="EXEMPT">Exempt</option>
                        <option value="OUTSIDE_SCOPE">Outside scope</option>
                      </select>
                      <input
                        required
                        aria-label={`Line ${index + 1} VAT rate`}
                        inputMode="decimal"
                        value={line.vatRate}
                        disabled={["ZERO", "EXEMPT", "OUTSIDE_SCOPE"].includes(
                          line.taxCategory,
                        )}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((item) =>
                              item.id === line.id
                                ? { ...item, vatRate: event.target.value }
                                : item,
                            ),
                          )
                        }
                        className="h-10 rounded-lg border border-slate-300 px-3 text-sm disabled:bg-slate-100"
                      />
                    </div>
                  </fieldset>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    emptyLine(crypto.randomUUID()),
                  ])
                }
                className="inline-flex items-center gap-2 text-sm font-semibold text-blue-800"
              >
                <Plus className="h-4 w-4" /> Add line
              </button>
              <label className="block text-sm font-medium">
                Notes
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={invoice.notes}
                  onChange={(event) =>
                    setInvoice((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-300 p-3"
                />
              </label>
              <button
                disabled={busy !== null}
                className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                Save controlled draft
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {dashboard && view === "payments" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Payment evidence</h2>
            {dashboard.payments.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
                No payments recorded.
              </p>
            ) : (
              dashboard.payments.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="font-semibold">{item.paymentNumber}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {item.clientName} · {statusLabel(item.method)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">
                        {money(item.amountMinor, item.currencyCode)}
                      </p>
                      <Badge value={item.paymentType} />
                    </div>
                  </div>
                </article>
              ))
            )}
          </section>
          {canRecordPayments ? (
            <form
              onSubmit={recordPayment}
              className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
            >
              <h2 className="font-semibold">Record cleared receipt</h2>
              <label className="block text-sm font-medium">
                Invoice
                <select
                  required
                  value={payment.documentId}
                  onChange={(event) => {
                    const document = openInvoices.find(
                      (item) => item.id === event.target.value,
                    );
                    setPayment((current) => ({
                      ...current,
                      documentId: event.target.value,
                      amount: document
                        ? (Number(document.balanceMinor) / 100).toFixed(2)
                        : "",
                    }));
                  }}
                  className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3"
                >
                  <option value="">Select open invoice</option>
                  {openInvoices.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.documentNumber} · {document.clientName} ·{" "}
                      {money(document.balanceMinor, document.currencyCode)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Amount
                <input
                  required
                  inputMode="decimal"
                  value={payment.amount}
                  onChange={(event) =>
                    setPayment((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3"
                />
              </label>
              <label className="block text-sm font-medium">
                Method
                <select
                  value={payment.method}
                  onChange={(event) =>
                    setPayment((current) => ({
                      ...current,
                      method: event.target.value,
                    }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3"
                >
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="CARD">Card</option>
                  <option value="CASH">Cash</option>
                  <option value="DIRECT_DEBIT">Direct debit</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Reference
                <input
                  maxLength={240}
                  value={payment.reference}
                  onChange={(event) =>
                    setPayment((current) => ({
                      ...current,
                      reference: event.target.value,
                    }))
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3"
                />
              </label>
              <button
                disabled={busy !== null}
                className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                Record, allocate and post
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {dashboard && view === "settings" ? (
        <form
          onSubmit={updateSettings}
          className="max-w-4xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            <h2 className="text-xl font-semibold">Legal invoice settings</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium sm:col-span-2">
              Legal name
              <input
                required
                disabled={!canManageSettings}
                value={settings.legalName}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    legalName: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 disabled:bg-slate-50"
              />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Address line 1
              <input
                required
                disabled={!canManageSettings}
                value={settings.addressLine1}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    addressLine1: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 disabled:bg-slate-50"
              />
            </label>
            <label className="text-sm font-medium">
              Address line 2
              <input
                disabled={!canManageSettings}
                value={settings.addressLine2}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    addressLine2: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 disabled:bg-slate-50"
              />
            </label>
            <label className="text-sm font-medium">
              City
              <input
                required
                disabled={!canManageSettings}
                value={settings.city}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    city: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 disabled:bg-slate-50"
              />
            </label>
            <label className="text-sm font-medium">
              Region
              <input
                disabled={!canManageSettings}
                value={settings.region}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    region: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 disabled:bg-slate-50"
              />
            </label>
            <label className="text-sm font-medium">
              Postcode
              <input
                required
                disabled={!canManageSettings}
                value={settings.postalCode}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    postalCode: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 disabled:bg-slate-50"
              />
            </label>
            <label className="text-sm font-medium">
              VAT scheme
              <select
                disabled={!canManageSettings}
                value={settings.vatScheme}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    vatScheme: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 disabled:bg-slate-50"
              >
                <option value="NOT_REGISTERED">Not VAT registered</option>
                <option value="STANDARD">Standard</option>
                <option value="CASH_ACCOUNTING">Cash accounting</option>
                <option value="FLAT_RATE">Flat rate</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              VAT registration number
              <input
                required={settings.vatScheme !== "NOT_REGISTERED"}
                disabled={
                  !canManageSettings || settings.vatScheme === "NOT_REGISTERED"
                }
                value={settings.vatRegistrationNumber}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    vatRegistrationNumber: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 disabled:bg-slate-50"
              />
            </label>
            <label className="text-sm font-medium">
              Payment terms (days)
              <input
                type="number"
                min={0}
                max={365}
                required
                disabled={!canManageSettings}
                value={settings.paymentTermsDays}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    paymentTermsDays: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 disabled:bg-slate-50"
              />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Payment instructions
              <textarea
                rows={3}
                maxLength={2000}
                disabled={!canManageSettings}
                value={settings.paymentInstructions}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    paymentInstructions: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-300 p-3 disabled:bg-slate-50"
              />
            </label>
          </div>
          {canManageSettings ? (
            <button
              disabled={busy !== null}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save finance settings
            </button>
          ) : null}
        </form>
      ) : null}

      {dashboard && view === "ledger" && canReadLedger ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Posted journal evidence</h2>
          {dashboard.journal.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
              No journals posted.
            </p>
          ) : (
            dashboard.journal.map((entry) => (
              <article
                key={entry.id}
                className="rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      {entry.entryNumber} · {entry.entryDate}
                    </p>
                    <p className="mt-1 font-semibold">{entry.description}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {statusLabel(entry.source)}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p>
                      Debit{" "}
                      {money(entry.debitMinor, dashboard.settings.baseCurrency)}
                    </p>
                    <p>
                      Credit{" "}
                      {money(
                        entry.creditMinor,
                        dashboard.settings.baseCurrency,
                      )}
                    </p>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}
