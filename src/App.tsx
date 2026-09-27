import { useCallback, useEffect, useState } from "react";
import CredentialForm from "./components/CredentialForm";
import RemoveDialog from "./components/RemoveDialog";
import { removeCredential, retryTracking, saveCredential } from "./credentials/operations";
import { listTracked } from "./credentials/tracking";
import type {
  CredentialCaller,
  CredentialTarget,
  TrackedCredential,
  TrackingMutation,
} from "./credentials/types";

type FormState = {
  scope: CredentialTarget["kind"];
  target?: CredentialTarget;
  username?: string;
};

type TrackingLoadState = "loading" | "ready" | "error";

function formatUpdatedAt(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        timestamp,
      );
}

function sameTarget(left: CredentialTarget, right: CredentialTarget): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "docker_hub" || (right.kind === "prefix" && left.prefix === right.prefix);
}

export default function App({ caller }: { caller: CredentialCaller }) {
  const [records, setRecords] = useState<TrackedCredential[]>([]);
  const [loadState, setLoadState] = useState<TrackingLoadState>("loading");
  const [form, setForm] = useState<FormState | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CredentialTarget | null>(null);
  const [pendingMutation, setPendingMutation] = useState<TrackingMutation | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [operationNotice, setOperationNotice] = useState("");

  const loadRecords = useCallback(async () => {
    setLoadState("loading");
    try {
      const loaded = await listTracked(caller);
      setRecords(loaded);
      setLoadError("");
      setLoadState("ready");
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "The credential tracking request failed.",
      );
      setLoadState("error");
    }
  }, [caller]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const hubRecord = records.find(
    (record): record is TrackedCredential & { target: { kind: "docker_hub" } } =>
      record.target.kind === "docker_hub",
  );
  const prefixRecords = records.filter(
    (
      record,
    ): record is TrackedCredential & { target: Extract<CredentialTarget, { kind: "prefix" }> } =>
      record.target.kind === "prefix",
  );
  const writesDisabled = actionBusy || pendingMutation !== null;

  function openForm(scope: CredentialTarget["kind"], record?: TrackedCredential) {
    setForm({ scope, target: record?.target, username: record?.username });
  }

  async function submitCredential(
    target: CredentialTarget,
    username: string,
    secret: string,
  ): Promise<void> {
    if (writesDisabled) return;
    setOperationNotice("");
    setActionBusy(true);
    try {
      const outcome = await saveCredential(caller, target, username, secret);
      setForm(null);
      if (outcome.kind === "tracking_failed") {
        setPendingMutation(outcome.pending);
      } else {
        const scope = target.kind === "docker_hub" ? "Docker Hub" : target.prefix;
        setOperationNotice(
          `${scope} credential was applied to the agent and tracking was updated.`,
        );
        await loadRecords();
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setForm(null);
    setActionBusy(true);
    setRemoveError("");
    try {
      const outcome = await removeCredential(caller, removeTarget);
      setRemoveTarget(null);
      if (outcome.kind === "tracking_failed") {
        setPendingMutation(outcome.pending);
      } else {
        setRecords((current) =>
          current.filter((record) => !sameTarget(record.target, removeTarget)),
        );
      }
    } catch (error) {
      setRemoveError(
        error instanceof Error ? error.message : "The credential could not be removed.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function retryPendingTracking() {
    if (!pendingMutation) return;
    setActionBusy(true);
    setRetryError("");
    try {
      await retryTracking(caller, pendingMutation);
      setPendingMutation(null);
      setOperationNotice("Tracking metadata was updated. The agent credential was not resent.");
      await loadRecords();
    } catch {
      setRetryError("The tracking record could not be updated. Try again.");
    } finally {
      setActionBusy(false);
    }
  }

  const editingHub = form?.scope === "docker_hub";
  const editingPrefix = form?.scope === "prefix";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="mb-8 flex flex-col gap-5 border-b border-slate-200 pb-8 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
              Deploy Commander / Agent settings
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Registry credentials
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Configure Docker Hub and registry access for the agent. This page tracks what this
              manager last configured; the agent&apos;s existing secret values cannot be viewed or
              verified here.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-800">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-blue-600" />
            Docker platform
          </div>
        </header>

        {pendingMutation && (
          <section
            aria-live="assertive"
            className="mb-7 flex flex-col gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
            role="alert"
          >
            <div>
              <h2 className="text-sm font-semibold text-amber-950">
                {pendingMutation.kind === "upsert"
                  ? "The agent credential was updated, but its tracking record was not."
                  : "The agent credential was removed, but its tracking record was not cleared."}
              </h2>
              <p className="mt-1 text-sm leading-5 text-amber-900">
                Retry the metadata update. The secret is not needed for this step.
              </p>
              {retryError && <p className="mt-2 text-sm font-medium text-rose-800">{retryError}</p>}
            </div>
            <button
              className="shrink-0 rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={actionBusy}
              onClick={retryPendingTracking}
              type="button"
            >
              {actionBusy ? "Updating…" : "Retry tracking update"}
            </button>
          </section>
        )}

        {loadState === "loading" && (
          <p
            className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600 shadow-sm"
            role="status"
          >
            Loading credential tracking records…
          </p>
        )}

        {loadState === "error" && (
          <div className="space-y-5">
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5" role="alert">
              <h2 className="font-semibold text-rose-950">
                Credential tracking could not be loaded.
              </h2>
              <p className="mt-1 text-sm text-rose-900">
                {loadError || "The manager database request failed."} Existing agent credential
                status is unknown because this manager cannot read credentials back.
              </p>
              <button
                className="mt-4 rounded-xl bg-rose-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={actionBusy}
                onClick={loadRecords}
                type="button"
              >
                {actionBusy ? "Retrying…" : "Retry loading"}
              </button>
            </section>

            {operationNotice && (
              <p
                className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-900"
                role="status"
              >
                {operationNotice}
              </p>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <h2 className="text-lg font-semibold text-slate-950">
                Configure credentials while tracking is unavailable
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Saving updates the selected agent scope, replacing any credential there. The manager
                will report whether it received confirmation and whether tracking saved.
              </p>
              {form ? (
                <CredentialForm
                  busy={writesDisabled}
                  key={form.scope === "docker_hub" ? "docker_hub" : "prefix:new"}
                  onCancel={() => setForm(null)}
                  onSubmit={submitCredential}
                  scope={form.scope}
                />
              ) : (
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={writesDisabled}
                    onClick={() => openForm("docker_hub")}
                    type="button"
                  >
                    Set or replace Docker Hub credential
                  </button>
                  <button
                    className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-800 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={writesDisabled}
                    onClick={() => openForm("prefix")}
                    type="button"
                  >
                    Add or replace registry-prefix credential
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {loadState === "ready" && (
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-8">
            <section
              aria-labelledby="docker-hub-heading"
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-sm font-bold tracking-tight text-blue-800">
                    DH
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950" id="docker-hub-heading">
                      Docker Hub
                    </h2>
                    <p className="mt-0.5 text-sm text-slate-500">Default registry credentials</p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${hubRecord ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
                >
                  {hubRecord ? "Tracked" : "Not tracked yet"}
                </span>
              </div>

              {hubRecord ? (
                <div className="mt-7 rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Tracked account
                  </p>
                  <p className="mt-1.5 font-medium text-slate-900">{hubRecord.username}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Last updated {formatUpdatedAt(hubRecord.updatedAt)}
                  </p>
                </div>
              ) : (
                <p className="mt-7 rounded-2xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-600">
                  No Docker Hub credential is tracked for this manager yet.
                </p>
              )}

              {!editingHub && (
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <button
                    className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={writesDisabled}
                    onClick={() => openForm("docker_hub", hubRecord)}
                    type="button"
                  >
                    {hubRecord ? "Replace Docker Hub credential" : "Add Docker Hub credential"}
                  </button>
                  {hubRecord && (
                    <button
                      className="rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={writesDisabled}
                      onClick={() => {
                        setRemoveError("");
                        setRemoveTarget(hubRecord.target);
                      }}
                      type="button"
                    >
                      Remove Docker Hub credential
                    </button>
                  )}
                </div>
              )}

              {editingHub && (
                <CredentialForm
                  busy={writesDisabled}
                  key="docker_hub"
                  initialTarget={form.target}
                  initialUsername={form.username}
                  onCancel={() => setForm(null)}
                  onSubmit={submitCredential}
                  scope="docker_hub"
                />
              )}

              <div className="mt-6 border-t border-slate-100 pt-5">
                <p className="text-xs leading-5 text-slate-500">
                  Docker Hub applies to image names without an explicit registry host. Images with
                  an explicit host, including{" "}
                  <code className="font-semibold text-slate-700">docker.io</code>, use a matching
                  prefix credential.
                </p>
              </div>
            </section>

            <section
              aria-labelledby="registry-prefixes-heading"
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Registry-specific access
                  </p>
                  <h2
                    className="mt-2 text-xl font-semibold tracking-tight text-slate-950"
                    id="registry-prefixes-heading"
                  >
                    Registry prefixes
                  </h2>
                  <p className="mt-1.5 max-w-lg text-sm leading-6 text-slate-600">
                    Use the longest matching prefix for private registries such as GHCR or a team
                    repository.
                  </p>
                </div>
                {!editingPrefix && (
                  <button
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-800 transition hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={writesDisabled}
                    onClick={() => openForm("prefix")}
                    type="button"
                  >
                    <span aria-hidden="true" className="text-lg leading-none">
                      +
                    </span>
                    Add prefix credential
                  </button>
                )}
              </div>

              {editingPrefix && (
                <CredentialForm
                  busy={writesDisabled}
                  key={form.target?.kind === "prefix" ? form.target.prefix : "new-prefix"}
                  initialTarget={form.target}
                  initialUsername={form.username}
                  onCancel={() => setForm(null)}
                  onSubmit={submitCredential}
                  scope="prefix"
                />
              )}

              {prefixRecords.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-center">
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg text-slate-500 shadow-sm">
                    /
                  </span>
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    No registry-prefix credentials tracked
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Add a registry host or repository prefix to get started.
                  </p>
                </div>
              ) : (
                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-semibold" scope="col">
                            Prefix
                          </th>
                          <th className="px-4 py-3 font-semibold" scope="col">
                            Username
                          </th>
                          <th className="px-4 py-3 font-semibold" scope="col">
                            Updated
                          </th>
                          <th className="px-4 py-3 text-right font-semibold" scope="col">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {prefixRecords.map((record) => (
                          <tr key={record.target.prefix}>
                            <td className="px-4 py-4 font-semibold text-slate-900">
                              {record.target.prefix}
                            </td>
                            <td className="px-4 py-4 text-slate-700">{record.username}</td>
                            <td className="px-4 py-4 text-xs text-slate-500">
                              {formatUpdatedAt(record.updatedAt)}
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex justify-end gap-1">
                                <button
                                  aria-label={`Replace ${record.target.prefix} credential`}
                                  className="rounded-lg px-2.5 py-2 text-xs font-semibold text-blue-800 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-50"
                                  disabled={writesDisabled}
                                  onClick={() => openForm("prefix", record)}
                                  type="button"
                                >
                                  Replace
                                </button>
                                <button
                                  aria-label={`Remove ${record.target.prefix} credential`}
                                  className="rounded-lg px-2.5 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-100 disabled:opacity-50"
                                  disabled={writesDisabled}
                                  onClick={() => {
                                    setRemoveError("");
                                    setRemoveTarget(record.target);
                                  }}
                                  type="button"
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        <footer className="mt-8 flex flex-col gap-2 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Passwords, personal access tokens, and secrets are never saved in this manager&apos;s
            database.
          </p>
          <p>Use a new secret whenever you replace a credential.</p>
        </footer>
      </div>

      {removeTarget && (
        <RemoveDialog
          busy={actionBusy}
          error={removeError}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={confirmRemove}
          target={removeTarget}
        />
      )}
    </main>
  );
}
