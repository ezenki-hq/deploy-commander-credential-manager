import { normalizePrefix } from "./input";
import type { CredentialCaller, CredentialTarget, TrackedCredential } from "./types";

type DatabaseQueryResult = Awaited<ReturnType<CredentialCaller["databaseQuery"]>>;

type TrackingRow = {
  scope: unknown;
  prefix?: unknown;
  username: unknown;
  updated_at: unknown;
};

const LIST_QUERY = "SELECT scope, prefix, username, updated_at FROM credential_tracking";

type TrackingLoadFailureCategory =
  "request_rejected" | "statement_error" | "invalid_response" | "invalid_data";

type TrackingLoadDiagnostics = {
  category: TrackingLoadFailureCategory;
  code?: string;
  message?: string;
};

export class TrackingLoadError extends Error {
  readonly category: TrackingLoadFailureCategory;
  readonly code?: string;

  constructor(diagnostics: TrackingLoadDiagnostics) {
    const fallbackMessages: Record<TrackingLoadFailureCategory, string> = {
      request_rejected: "The manager database request was rejected.",
      statement_error: "The database rejected the tracking query.",
      invalid_response: "The database returned an invalid tracking response.",
      invalid_data: "Tracking records contain unsupported data.",
    };
    super(diagnostics.message ?? fallbackMessages[diagnostics.category]);
    this.name = "TrackingLoadError";
    this.category = diagnostics.category;
    this.code = diagnostics.code;
  }

  diagnostics(): TrackingLoadDiagnostics {
    return {
      category: this.category,
      ...(this.code ? { code: this.code } : {}),
      message: this.message,
    };
  }
}

function safeDiagnosticMessage(value: unknown): string | undefined {
  let message: string | undefined;
  if (typeof value === "string") message = value;
  else if (isRecord(value) && typeof value.message === "string") message = value.message;
  else if (value instanceof Error) message = value.message;
  if (!message) return undefined;

  return message
    .replace(/\b(password|token|secret|authorization)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .trim()
    .slice(0, 300);
}

function safeDiagnosticCode(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.code !== "string") return undefined;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value.code) ? value.code : undefined;
}

function trackingLoadFailure(
  category: TrackingLoadFailureCategory,
  value?: unknown,
): TrackingLoadError {
  return new TrackingLoadError({
    category,
    ...(safeDiagnosticCode(value) ? { code: safeDiagnosticCode(value) } : {}),
    ...(safeDiagnosticMessage(value) ? { message: safeDiagnosticMessage(value) } : {}),
  });
}

function normalizedTarget(target: CredentialTarget): CredentialTarget {
  return target.kind === "prefix"
    ? { kind: "prefix", prefix: normalizePrefix(target.prefix) }
    : target;
}

function trackingKey(target: CredentialTarget): string {
  const normalized = normalizedTarget(target);
  return normalized.kind === "docker_hub" ? "docker_hub" : `prefix:${normalized.prefix}`;
}

function statementResult(response: DatabaseQueryResult): unknown {
  if (!response || !Array.isArray(response.results) || response.results.length !== 1) {
    throw new Error("Unable to update credential tracking.");
  }

  const [statement] = response.results;
  if (statement.status !== "OK") {
    throw new Error("Unable to update credential tracking.");
  }

  return statement.result;
}

function parseTimestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value))) {
    return value;
  }
  throw new Error("Credential tracking data is invalid.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRow(value: unknown): TrackedCredential {
  if (!isRecord(value)) throw new Error("Credential tracking data is invalid.");
  const row = value as TrackingRow;
  if (typeof row.username !== "string" || !row.username.trim()) {
    throw new Error("Credential tracking data is invalid.");
  }

  const updatedAt = parseTimestamp(row.updated_at);
  if (row.scope === "docker_hub") {
    if (row.prefix !== null && row.prefix !== undefined) {
      throw new Error("Credential tracking data is invalid.");
    }
    return { target: { kind: "docker_hub" }, username: row.username, updatedAt };
  }

  if (row.scope === "prefix" && typeof row.prefix === "string") {
    return {
      target: { kind: "prefix", prefix: normalizePrefix(row.prefix) },
      username: row.username,
      updatedAt,
    };
  }

  throw new Error("Credential tracking data is invalid.");
}

export async function listTracked(caller: CredentialCaller): Promise<TrackedCredential[]> {
  try {
    const response = await caller.databaseQuery(LIST_QUERY);
    if (!response || !Array.isArray(response.results) || response.results.length !== 1) {
      throw trackingLoadFailure("invalid_response");
    }

    const [statement] = response.results;
    if (!isRecord(statement)) throw trackingLoadFailure("invalid_response");
    if (statement.status !== "OK") {
      throw trackingLoadFailure("statement_error", statement.result);
    }
    if (!Array.isArray(statement.result)) throw trackingLoadFailure("invalid_response");

    try {
      return statement.result.map(parseRow);
    } catch {
      throw trackingLoadFailure("invalid_data");
    }
  } catch (error) {
    const failure =
      error instanceof TrackingLoadError ? error : trackingLoadFailure("request_rejected", error);
    console.error("[credential-manager] tracking load failed", failure.diagnostics());
    throw failure;
  }
}

export async function upsertTracked(
  caller: CredentialCaller,
  target: CredentialTarget,
  username: string,
): Promise<TrackedCredential> {
  const normalized = normalizedTarget(target);
  const scope = normalized.kind;
  const prefix = normalized.kind === "prefix" ? normalized.prefix : null;
  const result = statementResult(
    await caller.databaseQuery(
      `UPSERT type::record('credential_tracking', $key) CONTENT {
        scope: $scope,
        prefix: $prefix,
        username: $username,
        updated_at: time::now()
      } RETURN AFTER`,
      { key: trackingKey(normalized), scope, prefix, username },
    ),
  );
  const row = Array.isArray(result) ? result[0] : result;
  return parseRow(row);
}

export async function deleteTracked(
  caller: CredentialCaller,
  target: CredentialTarget,
): Promise<void> {
  statementResult(
    await caller.databaseQuery("DELETE type::record('credential_tracking', $key)", {
      key: trackingKey(target),
    }),
  );
}
