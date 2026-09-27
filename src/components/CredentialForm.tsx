import { useState, type FormEvent } from "react";
import { normalizePrefix, normalizeUsername, validateSecret } from "../credentials/input";
import type { CredentialTarget } from "../credentials/types";

type CredentialFormProps = {
  scope: CredentialTarget["kind"];
  initialTarget?: CredentialTarget;
  initialUsername?: string;
  busy?: boolean;
  onSubmit: (target: CredentialTarget, username: string, secret: string) => Promise<void>;
  onCancel: () => void;
};

export default function CredentialForm({
  scope,
  initialTarget,
  initialUsername = "",
  busy = false,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const [prefix, setPrefix] = useState(
    initialTarget?.kind === "prefix" ? initialTarget.prefix : "",
  );
  const [username, setUsername] = useState(initialUsername);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    let target: CredentialTarget;
    let validUsername: string;
    let validSecret: string;
    try {
      target =
        scope === "docker_hub"
          ? { kind: "docker_hub" }
          : { kind: "prefix", prefix: normalizePrefix(prefix) };
      validUsername = normalizeUsername(username);
      validSecret = validateSecret(secret);
    } catch (validationError) {
      setError(
        validationError instanceof Error ? validationError.message : "Check the form values.",
      );
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(target, validUsername, validSecret);
      setSecret("");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "The credential could not be saved.",
      );
      setSecret("");
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = busy || submitting;
  const isPrefix = scope === "prefix";

  return (
    <form
      className="mt-5 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      onSubmit={handleSubmit}
    >
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          {isPrefix ? "Registry authentication" : "Docker Hub authentication"}
        </h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Enter a new secret each time. The value is sent to the agent and is not saved in this
          manager&apos;s database.
        </p>
      </div>

      {isPrefix && (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-800" htmlFor="registry-prefix">
            Registry host or prefix
          </label>
          <input
            autoComplete="off"
            className="block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50"
            id="registry-prefix"
            onChange={(event) => setPrefix(event.target.value)}
            placeholder="ghcr.io/team"
            required
            value={prefix}
          />
          <p className="text-xs leading-5 text-slate-500">
            Use a registry host with an optional repository path. Do not include a URL scheme or
            trailing slash.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-800" htmlFor="credential-username">
          Username
        </label>
        <input
          autoComplete="username"
          className="block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50"
          id="credential-username"
          onChange={(event) => setUsername(event.target.value)}
          placeholder="registry account"
          required
          value={username}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-800" htmlFor="credential-secret">
          Password, personal access token, or secret
        </label>
        <input
          autoComplete="new-password"
          className="block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50"
          id="credential-secret"
          onChange={(event) => setSecret(event.target.value)}
          placeholder="Enter a password, token, or secret"
          required
          type="password"
          value={secret}
        />
        <p className="text-xs leading-5 text-slate-500">
          Existing secret values cannot be viewed. Replacing this credential requires a new value.
        </p>
      </div>

      {error && (
        <p
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
        <button
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:opacity-60"
          disabled={disabled}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          type="submit"
        >
          {disabled ? "Saving…" : "Save credential"}
        </button>
      </div>
    </form>
  );
}
