"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";

import {
  assuranceEvidenceStatuses,
  breachNotificationDecisions,
  dataSubjectRequestStatuses,
  dataSubjectRequestTypes,
  identityProofStatuses,
  privacyIncidentSeverities,
  privacyIncidentStatuses,
  retentionActions,
  retentionReviewStatuses,
  type AssuranceEvidence,
  type ComplianceAssuranceDashboard,
  type DataSubjectRight,
  type LegalHold,
  type PrivacyIncident,
  type RetentionPolicy,
  type RetentionReview,
} from "@/lib/compliance-assurance";

export type AssuranceAction =
  | { kind: "right.create" }
  | { kind: "right.transition"; item: DataSubjectRight }
  | { kind: "right.extend"; item: DataSubjectRight }
  | { kind: "incident.create" }
  | { kind: "incident.update"; item: PrivacyIncident }
  | { kind: "hold.create" }
  | { kind: "hold.release"; item: LegalHold }
  | { kind: "policy.upsert"; item?: RetentionPolicy }
  | { kind: "retention-review.create" }
  | { kind: "retention-review.decide"; item: RetentionReview }
  | { kind: "evidence.record"; item?: AssuranceEvidence }
  | { kind: "evidence.review"; item: AssuranceEvidence }
  | { kind: "release.decide" };

type Props = {
  action: AssuranceAction;
  dashboard: ComplianceAssuranceDashboard;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (
    operation: string,
    identifiers: Record<string, string>,
    payload: Record<string, unknown>,
  ) => Promise<void>;
};

const fieldClass =
  "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const areaClass = `${fieldClass} h-24 py-2`;

function Label({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-semibold text-slate-700"
    >
      {children}
    </label>
  );
}

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function nullable(form: FormData, name: string): string | null {
  return value(form, name) || null;
}

function localDateTime(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function addDays(value: string, days: number): string {
  return new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
}

function iso(form: FormData, name: string): string {
  return new Date(value(form, name)).toISOString();
}

function nullableIso(form: FormData, name: string): string | null {
  const candidate = nullable(form, name);
  return candidate ? new Date(candidate).toISOString() : null;
}

function title(action: AssuranceAction): string {
  switch (action.kind) {
    case "right.create":
      return "Record data-right request";
    case "right.transition":
      return `Update ${action.item.requestReference}`;
    case "right.extend":
      return `Extend ${action.item.requestReference}`;
    case "incident.create":
      return "Record privacy incident";
    case "incident.update":
      return `Update ${action.item.incidentReference}`;
    case "hold.create":
      return "Create legal hold";
    case "hold.release":
      return "Release legal hold";
    case "policy.upsert":
      return action.item
        ? "Update retention policy"
        : "Create retention policy";
    case "retention-review.create":
      return "Schedule retention review";
    case "retention-review.decide":
      return "Record retention decision";
    case "evidence.record":
      return action.item
        ? "Submit replacement evidence"
        : "Add assurance evidence";
    case "evidence.review":
      return "Independently review evidence";
    case "release.decide":
      return "Record release decision";
  }
}

export function AssuranceActionDialog({
  action,
  dashboard,
  busy,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [validationError, setValidationError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    const form = new FormData(event.currentTarget);
    switch (action.kind) {
      case "right.create":
        await onSubmit(
          "right.create",
          {},
          {
            requestType: value(form, "requestType"),
            subjectName: value(form, "subjectName"),
            subjectEmail: nullable(form, "subjectEmail"),
            subjectPhone: nullable(form, "subjectPhone"),
            clientId: nullable(form, "clientId"),
            receivedAt: nullableIso(form, "receivedAt"),
            requestDetails: value(form, "requestDetails"),
            ownerUserId: null,
          },
        );
        return;
      case "right.transition":
        await onSubmit(
          "right.transition",
          { requestId: action.item.id },
          {
            status: value(form, "status"),
            identityStatus: value(form, "identityStatus"),
            note: value(form, "note"),
            evidenceReference: nullable(form, "evidenceReference"),
            responseReference: nullable(form, "responseReference"),
            expectedVersion: action.item.version,
          },
        );
        return;
      case "right.extend":
        await onSubmit(
          "right.extend",
          { requestId: action.item.id },
          {
            extendedDueAt: iso(form, "extendedDueAt"),
            reason: value(form, "reason"),
            notificationReference: value(form, "notificationReference"),
            expectedVersion: action.item.version,
          },
        );
        return;
      case "incident.create":
        await onSubmit(
          "incident.create",
          {},
          {
            title: value(form, "title"),
            description: value(form, "description"),
            severity: value(form, "severity"),
            personalDataBreach: form.get("personalDataBreach") === "on",
            discoveredAt: iso(form, "discoveredAt"),
            dataCategories: value(form, "dataCategories")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            approximatePeopleAffected: Number(
              value(form, "approximatePeopleAffected"),
            ),
            ownerUserId: null,
          },
        );
        return;
      case "incident.update":
        await onSubmit(
          "incident.update",
          { incidentId: action.item.id },
          {
            status: value(form, "status"),
            severity: value(form, "severity"),
            personalDataBreach: form.get("personalDataBreach") === "on",
            notificationDecision: value(form, "notificationDecision"),
            containedAt: nullableIso(form, "containedAt"),
            riskAssessment: value(form, "riskAssessment"),
            resolution: nullable(form, "resolution"),
            icoReference: nullable(form, "icoReference"),
            subjectNotificationEvidence: nullable(
              form,
              "subjectNotificationEvidence",
            ),
            eventNote: value(form, "eventNote"),
            evidenceReference: nullable(form, "evidenceReference"),
            expectedVersion: action.item.version,
          },
        );
        return;
      case "hold.create": {
        const scopeType = value(form, "scopeType");
        await onSubmit(
          "hold.create",
          {},
          {
            scopeType,
            scopeId:
              scopeType === "ORGANISATION" ? null : nullable(form, "scopeId"),
            reason: value(form, "reason"),
            startsAt: iso(form, "startsAt"),
            expiresAt: nullableIso(form, "expiresAt"),
          },
        );
        return;
      }
      case "hold.release":
        await onSubmit(
          "hold.release",
          { holdId: action.item.id },
          {
            releaseReason: value(form, "releaseReason"),
            expectedVersion: action.item.version,
          },
        );
        return;
      case "policy.upsert":
        await onSubmit(
          "policy.upsert",
          {},
          {
            policyKey: value(form, "policyKey"),
            name: value(form, "name"),
            resourceType: value(form, "resourceType"),
            triggerEvent: value(form, "triggerEvent"),
            retentionDays: Number(value(form, "retentionDays")),
            action: value(form, "action"),
            lawfulReason: value(form, "lawfulReason"),
            isActive: form.get("isActive") === "on",
            expectedVersion: action.item?.version,
          },
        );
        return;
      case "retention-review.create":
        await onSubmit(
          "retention-review.create",
          {},
          {
            resourceType: value(form, "resourceType"),
            resourceId: value(form, "resourceId"),
            policyId: value(form, "policyId"),
            dueAt: iso(form, "dueAt"),
            ownerUserId: null,
          },
        );
        return;
      case "retention-review.decide":
        await onSubmit(
          "retention-review.decide",
          { reviewId: action.item.id },
          {
            status: value(form, "status"),
            decision: value(form, "decision"),
            notes: value(form, "notes"),
            completionEvidenceReference: nullable(
              form,
              "completionEvidenceReference",
            ),
            expectedVersion: action.item.version,
          },
        );
        return;
      case "evidence.record": {
        let scope: unknown;
        try {
          scope = JSON.parse(value(form, "scope"));
        } catch {
          setValidationError("Scope must be a valid JSON object.");
          return;
        }
        await onSubmit(
          "evidence.record",
          {},
          {
            evidenceKey: value(form, "evidenceKey"),
            title: value(form, "title"),
            category: value(form, "category"),
            evidenceReference: value(form, "evidenceReference"),
            evidenceSha256: value(form, "evidenceSha256"),
            assessorName: value(form, "assessorName"),
            assessorOrganisation: nullable(form, "assessorOrganisation"),
            scope,
            testedAt: iso(form, "testedAt"),
            expiresAt: iso(form, "expiresAt"),
            notes: value(form, "notes"),
            expectedVersion: action.item?.version,
          },
        );
        return;
      }
      case "evidence.review":
        await onSubmit(
          "evidence.review",
          { evidenceId: action.item.id },
          {
            status: value(form, "status"),
            reviewNote: value(form, "reviewNote"),
            expectedVersion: action.item.version,
          },
        );
        return;
      case "release.decide":
        await onSubmit(
          "release.decide",
          {},
          {
            releaseReference: value(form, "releaseReference"),
            environment: value(form, "environment"),
            decision: value(form, "decision"),
            rationale: value(form, "rationale"),
            changeReference: nullable(form, "changeReference"),
          },
        );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assurance-dialog-title"
        className="max-h-[92vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id="assurance-dialog-title" className="text-base font-bold">
              {title(action)}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              AAL2, tenant policy, version checks and audit evidence apply.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(event) => void submit(event)}
          className="flex max-h-[calc(92vh-65px)] flex-col"
        >
          <div className="grid gap-3 overflow-y-auto p-4 sm:grid-cols-2">
            <ActionFields action={action} dashboard={dashboard} />
            {error || validationError ? (
              <p
                role="alert"
                className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                {error ?? validationError} No change was confirmed.
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-9 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Confirm and record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ActionFields({
  action,
  dashboard,
}: {
  action: AssuranceAction;
  dashboard: ComplianceAssuranceDashboard;
}) {
  switch (action.kind) {
    case "right.create":
      return (
        <>
          <div>
            <Label htmlFor="requestType">Right</Label>
            <select id="requestType" name="requestType" className={fieldClass}>
              {dataSubjectRequestTypes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="subjectName">Person</Label>
            <input
              required
              id="subjectName"
              name="subjectName"
              className={fieldClass}
              autoComplete="name"
            />
          </div>
          <div>
            <Label htmlFor="subjectEmail">Email</Label>
            <input
              id="subjectEmail"
              name="subjectEmail"
              type="email"
              className={fieldClass}
              autoComplete="email"
            />
          </div>
          <div>
            <Label htmlFor="subjectPhone">Telephone</Label>
            <input
              id="subjectPhone"
              name="subjectPhone"
              className={fieldClass}
              autoComplete="tel"
            />
          </div>
          <div>
            <Label htmlFor="clientId">Linked client UUID (optional)</Label>
            <input id="clientId" name="clientId" className={fieldClass} />
          </div>
          <div>
            <Label htmlFor="receivedAt">Received</Label>
            <input
              id="receivedAt"
              name="receivedAt"
              type="datetime-local"
              defaultValue={localDateTime(dashboard.generatedAt)}
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="requestDetails">Request and intake evidence</Label>
            <textarea
              required
              id="requestDetails"
              name="requestDetails"
              minLength={10}
              className={areaClass}
            />
          </div>
        </>
      );
    case "right.transition":
      return (
        <>
          <div>
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={action.item.status}
              className={fieldClass}
            >
              {dataSubjectRequestStatuses.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="identityStatus">Identity check</Label>
            <select
              id="identityStatus"
              name="identityStatus"
              defaultValue={action.item.identityStatus}
              className={fieldClass}
            >
              {identityProofStatuses.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="evidenceReference">Evidence reference</Label>
            <input
              id="evidenceReference"
              name="evidenceReference"
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="responseReference">Response reference</Label>
            <input
              id="responseReference"
              name="responseReference"
              defaultValue={action.item.responseReference ?? ""}
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="note">Decision note</Label>
            <textarea
              required
              id="note"
              name="note"
              minLength={10}
              className={areaClass}
            />
          </div>
        </>
      );
    case "right.extend":
      return (
        <>
          <div>
            <Label htmlFor="extendedDueAt">Extended deadline</Label>
            <input
              required
              id="extendedDueAt"
              name="extendedDueAt"
              type="datetime-local"
              min={localDateTime(action.item.dueAt)}
              max={localDateTime(addDays(action.item.dueAt, 62))}
              defaultValue={localDateTime(addDays(action.item.dueAt, 30))}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="notificationReference">
              Notification evidence reference
            </Label>
            <input
              required
              minLength={8}
              id="notificationReference"
              name="notificationReference"
              placeholder="document://notice/…"
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="reason">Complexity or request-volume reason</Label>
            <textarea
              required
              minLength={20}
              id="reason"
              name="reason"
              className={areaClass}
            />
            <p className="mt-1 text-xs leading-4 text-slate-500">
              BusinessOS records the assessment and notice evidence. An
              authorised person remains responsible for deciding whether the
              extension is lawful.
            </p>
          </div>
        </>
      );
    case "incident.create":
      return (
        <>
          <div className="sm:col-span-2">
            <Label htmlFor="title">Title</Label>
            <input required id="title" name="title" className={fieldClass} />
          </div>
          <div>
            <Label htmlFor="severity">Severity</Label>
            <select
              id="severity"
              name="severity"
              defaultValue="MEDIUM"
              className={fieldClass}
            >
              {privacyIncidentSeverities.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="discoveredAt">Discovered</Label>
            <input
              required
              id="discoveredAt"
              name="discoveredAt"
              type="datetime-local"
              defaultValue={localDateTime(dashboard.generatedAt)}
              className={fieldClass}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input name="personalDataBreach" type="checkbox" /> Personal-data
            breach
          </label>
          <div>
            <Label htmlFor="approximatePeopleAffected">People affected</Label>
            <input
              required
              min={0}
              id="approximatePeopleAffected"
              name="approximatePeopleAffected"
              type="number"
              defaultValue={0}
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="dataCategories">
              Data categories (comma-separated)
            </Label>
            <input
              required
              id="dataCategories"
              name="dataCategories"
              placeholder="identity, contact, financial"
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="description">What happened</Label>
            <textarea
              required
              minLength={20}
              id="description"
              name="description"
              className={areaClass}
            />
          </div>
        </>
      );
    case "incident.update":
      return (
        <>
          <div>
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={action.item.status}
              className={fieldClass}
            >
              {privacyIncidentStatuses.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="severity">Severity</Label>
            <select
              id="severity"
              name="severity"
              defaultValue={action.item.severity}
              className={fieldClass}
            >
              {privacyIncidentSeverities.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="notificationDecision">Notification decision</Label>
            <select
              id="notificationDecision"
              name="notificationDecision"
              defaultValue={action.item.notificationDecision}
              className={fieldClass}
            >
              {breachNotificationDecisions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="containedAt">Contained at</Label>
            <input
              id="containedAt"
              name="containedAt"
              type="datetime-local"
              defaultValue={
                action.item.containedAt
                  ? localDateTime(action.item.containedAt)
                  : ""
              }
              className={fieldClass}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              name="personalDataBreach"
              type="checkbox"
              defaultChecked={action.item.personalDataBreach}
            />{" "}
            Personal-data breach
          </label>
          <span />
          <div className="sm:col-span-2">
            <Label htmlFor="riskAssessment">Risk assessment</Label>
            <textarea
              required
              minLength={20}
              id="riskAssessment"
              name="riskAssessment"
              defaultValue={action.item.riskAssessment ?? ""}
              className={areaClass}
            />
          </div>
          <div>
            <Label htmlFor="icoReference">ICO reference</Label>
            <input
              id="icoReference"
              name="icoReference"
              defaultValue={action.item.icoReference ?? ""}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="subjectNotificationEvidence">
              People-notified evidence
            </Label>
            <input
              id="subjectNotificationEvidence"
              name="subjectNotificationEvidence"
              defaultValue={action.item.subjectNotificationEvidence ?? ""}
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="resolution">Resolution</Label>
            <textarea
              id="resolution"
              name="resolution"
              defaultValue={action.item.resolution ?? ""}
              className={areaClass}
            />
          </div>
          <div>
            <Label htmlFor="evidenceReference">Event evidence</Label>
            <input
              id="evidenceReference"
              name="evidenceReference"
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="eventNote">Event note</Label>
            <input
              required
              minLength={10}
              id="eventNote"
              name="eventNote"
              className={fieldClass}
            />
          </div>
        </>
      );
    case "hold.create":
      return (
        <>
          <div>
            <Label htmlFor="scopeType">Scope</Label>
            <select id="scopeType" name="scopeType" className={fieldClass}>
              <option>ORGANISATION</option>
              <option>CLIENT</option>
              <option>MATTER</option>
              <option>DOCUMENT</option>
            </select>
          </div>
          <div>
            <Label htmlFor="scopeId">Scoped record UUID</Label>
            <input id="scopeId" name="scopeId" className={fieldClass} />
          </div>
          <div>
            <Label htmlFor="startsAt">Starts</Label>
            <input
              required
              id="startsAt"
              name="startsAt"
              type="datetime-local"
              defaultValue={localDateTime(dashboard.generatedAt)}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="expiresAt">Expires (optional)</Label>
            <input
              id="expiresAt"
              name="expiresAt"
              type="datetime-local"
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="reason">Legal basis and matter reference</Label>
            <textarea
              required
              minLength={10}
              id="reason"
              name="reason"
              className={areaClass}
            />
          </div>
        </>
      );
    case "hold.release":
      return (
        <div className="sm:col-span-2">
          <Label htmlFor="releaseReason">Release authority and reason</Label>
          <textarea
            required
            minLength={10}
            id="releaseReason"
            name="releaseReason"
            className={areaClass}
          />
        </div>
      );
    case "policy.upsert":
      return (
        <>
          <div>
            <Label htmlFor="policyKey">Policy key</Label>
            <input
              required
              id="policyKey"
              name="policyKey"
              readOnly={Boolean(action.item)}
              defaultValue={action.item?.policyKey ?? ""}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="name">Name</Label>
            <input
              required
              id="name"
              name="name"
              defaultValue={action.item?.name ?? ""}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="resourceType">Resource type</Label>
            <input
              required
              id="resourceType"
              name="resourceType"
              defaultValue={action.item?.resourceType ?? "client"}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="triggerEvent">Trigger</Label>
            <input
              required
              id="triggerEvent"
              name="triggerEvent"
              defaultValue={action.item?.triggerEvent ?? "relationship ended"}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="retentionDays">Retention days</Label>
            <input
              required
              min={1}
              max={36500}
              id="retentionDays"
              name="retentionDays"
              type="number"
              defaultValue={action.item?.retentionDays ?? 2190}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="action">Disposition</Label>
            <select
              id="action"
              name="action"
              defaultValue={action.item?.action ?? "REVIEW"}
              className={fieldClass}
            >
              {retentionActions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              name="isActive"
              type="checkbox"
              defaultChecked={action.item?.isActive ?? true}
            />{" "}
            Active policy
          </label>
          <span />
          <div className="sm:col-span-2">
            <Label htmlFor="lawfulReason">
              Lawful and operational rationale
            </Label>
            <textarea
              required
              minLength={10}
              id="lawfulReason"
              name="lawfulReason"
              defaultValue={action.item?.lawfulReason ?? ""}
              className={areaClass}
            />
          </div>
        </>
      );
    case "retention-review.create":
      return (
        <>
          <div>
            <Label htmlFor="policyId">Policy</Label>
            <select
              required
              id="policyId"
              name="policyId"
              className={fieldClass}
            >
              {dashboard.retention.policies
                .filter((item) => item.isActive)
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <Label htmlFor="resourceType">Resource type</Label>
            <input
              required
              id="resourceType"
              name="resourceType"
              defaultValue="client"
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="resourceId">Record UUID</Label>
            <input
              required
              id="resourceId"
              name="resourceId"
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="dueAt">Review due</Label>
            <input
              required
              id="dueAt"
              name="dueAt"
              type="datetime-local"
              defaultValue={localDateTime(addDays(dashboard.generatedAt, 7))}
              className={fieldClass}
            />
          </div>
        </>
      );
    case "retention-review.decide":
      return (
        <>
          <div>
            <Label htmlFor="status">Outcome</Label>
            <select
              id="status"
              name="status"
              defaultValue="APPROVED"
              className={fieldClass}
            >
              {retentionReviewStatuses
                .filter((item) =>
                  ["BLOCKED", "APPROVED", "COMPLETED", "CANCELLED"].includes(
                    item,
                  ),
                )
                .map((item) => (
                  <option key={item}>{item}</option>
                ))}
            </select>
          </div>
          <div>
            <Label htmlFor="decision">Disposition</Label>
            <select
              id="decision"
              name="decision"
              defaultValue={
                action.item.decision ??
                dashboard.retention.policies.find(
                  (item) => item.id === action.item.policyId,
                )?.action ??
                "REVIEW"
              }
              className={fieldClass}
            >
              {retentionActions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="completionEvidenceReference">
              Execution evidence (required for COMPLETED)
            </Label>
            <input
              id="completionEvidenceReference"
              name="completionEvidenceReference"
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Decision rationale</Label>
            <textarea
              required
              minLength={10}
              id="notes"
              name="notes"
              className={areaClass}
            />
          </div>
        </>
      );
    case "evidence.record":
      return (
        <>
          <div>
            <Label htmlFor="evidenceKey">Evidence key</Label>
            <input
              required
              readOnly={Boolean(action.item?.mandatory)}
              id="evidenceKey"
              name="evidenceKey"
              defaultValue={action.item?.evidenceKey ?? ""}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="title">Control</Label>
            <input
              required
              readOnly={Boolean(action.item?.mandatory)}
              id="title"
              name="title"
              defaultValue={action.item?.title ?? ""}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <input
              required
              readOnly={Boolean(action.item?.mandatory)}
              id="category"
              name="category"
              defaultValue={action.item?.category ?? "SECURITY"}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="assessorName">Assessor</Label>
            <input
              required
              id="assessorName"
              name="assessorName"
              defaultValue={action.item?.assessorName ?? ""}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="assessorOrganisation">
              Independent organisation
            </Label>
            <input
              id="assessorOrganisation"
              name="assessorOrganisation"
              defaultValue={action.item?.assessorOrganisation ?? ""}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="evidenceReference">
              Immutable evidence location
            </Label>
            <input
              required
              minLength={8}
              id="evidenceReference"
              name="evidenceReference"
              defaultValue={action.item?.evidenceReference ?? ""}
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="evidenceSha256">SHA-256</Label>
            <input
              required
              pattern="[a-fA-F0-9]{64}"
              id="evidenceSha256"
              name="evidenceSha256"
              defaultValue={action.item?.evidenceSha256 ?? ""}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="testedAt">Tested</Label>
            <input
              required
              id="testedAt"
              name="testedAt"
              type="datetime-local"
              defaultValue={localDateTime(dashboard.generatedAt)}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="expiresAt">Expires</Label>
            <input
              required
              id="expiresAt"
              name="expiresAt"
              type="datetime-local"
              defaultValue={localDateTime(addDays(dashboard.generatedAt, 90))}
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="scope">Scope JSON</Label>
            <textarea
              required
              id="scope"
              name="scope"
              defaultValue={JSON.stringify(
                action.item?.scope ?? { environment: "production" },
                null,
                2,
              )}
              className={areaClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Limitations, method and result</Label>
            <textarea
              required
              minLength={10}
              id="notes"
              name="notes"
              defaultValue={action.item?.notes ?? ""}
              className={areaClass}
            />
          </div>
        </>
      );
    case "evidence.review":
      return (
        <>
          <p className="sm:col-span-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            The submitter cannot review their own evidence. Verify the SHA-256
            and source before deciding.
          </p>
          <div>
            <Label htmlFor="status">Decision</Label>
            <select
              id="status"
              name="status"
              defaultValue="PASS"
              className={fieldClass}
            >
              {assuranceEvidenceStatuses
                .filter((item) => ["PASS", "FAIL", "BLOCKED"].includes(item))
                .map((item) => (
                  <option key={item}>{item}</option>
                ))}
            </select>
          </div>
          <span />
          <div className="sm:col-span-2">
            <Label htmlFor="reviewNote">Independent review</Label>
            <textarea
              required
              minLength={10}
              id="reviewNote"
              name="reviewNote"
              className={areaClass}
            />
          </div>
        </>
      );
    case "release.decide":
      return (
        <>
          <div>
            <Label htmlFor="releaseReference">Release reference</Label>
            <input
              required
              id="releaseReference"
              name="releaseReference"
              defaultValue={`release-${dashboard.generatedAt.slice(0, 10)}`}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="environment">Environment</Label>
            <select
              id="environment"
              name="environment"
              defaultValue="PRODUCTION"
              className={fieldClass}
            >
              <option>PRODUCTION</option>
              <option>STAGING</option>
            </select>
          </div>
          <div>
            <Label htmlFor="decision">Decision</Label>
            <select
              id="decision"
              name="decision"
              defaultValue={
                dashboard.assurance.releaseEligible ? "APPROVED" : "BLOCKED"
              }
              className={fieldClass}
            >
              <option>BLOCKED</option>
              <option disabled={!dashboard.assurance.releaseEligible}>
                APPROVED
              </option>
              <option>REVOKED</option>
            </select>
          </div>
          <div>
            <Label htmlFor="changeReference">Change reference</Label>
            <input
              id="changeReference"
              name="changeReference"
              className={fieldClass}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rationale">Release authority rationale</Label>
            <textarea
              required
              minLength={20}
              id="rationale"
              name="rationale"
              className={areaClass}
            />
          </div>
        </>
      );
  }
}
