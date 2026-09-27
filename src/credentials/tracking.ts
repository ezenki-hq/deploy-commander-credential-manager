import { normalizePrefix } from "./input";
import type { CredentialCaller, CredentialTarget, TrackedCredential } from "./types";

type DatabaseQueryResult = Awaited<ReturnType<CredentialCaller["databaseQuery"]>>;

type TrackingRow = {
  scope: unknown;
  prefix?: unknown;
  username: unknown;
  updated_at: unknown;
};

const TRACKING_TABLE = "credential_tracking";
const LIST_QUERY = "SELECT scope, prefix, username, updated_at FROM credential_tracking";
const TRACKING_SCHEMA_QUERY = "INFO FOR DB";
const CREATE_TRACKING_TABLE_QUERY = "DEFINE TABLE credential_tracking SCHEMALESS";

type TrackingLoadFailureCategory =
  | "request_rejected"
  | "statement_error"
  | "invalid_response"
  | "invalid_data"
  | "schema_inspection_failed"
  | "schema_creation_failed"
  | "schema_response_invalid";

type TrackingLoadDiagnostics = {
  category: TrackingLoadFailureCategory;
  statementStatus?: "ERR";
};

export class TrackingLoadError extends Error {
  readonly category: TrackingLoadFailureCategory;
  private readonly statementStatus?: "ERR";

  constructor(category: TrackingLoadFailureCategory, statementStatus?: "ERR") {
    const fallbackMessages: Record<TrackingLoadFailureCategory, string> = {
      request_rejected: "The manager database request was rejected.",
      statement_error: "The database rejected the tracking query.",
      invalid_response: "The database returned an invalid tracking response.",
      invalid_data: "Tracking records contain unsupported data.",
      schema_inspection_failed: "The manager database schema could not be checked.",
      schema_creation_failed: "The credential tracking table could not be initialized.",
      schema_response_invalid: "The manager database returned an invalid schema response.",
    };
    super(fallbackMessages[category]);
    this.name = "TrackingLoadError";
    this.category = category;
    this.statementStatus = statementStatus;
  }

  diagnostics(): TrackingLoadDiagnostics {
    return {
      category: this.category,
      ...(this.statementStatus ? { statementStatus: this.statementStatus } : {}),
    };
  }
}

function trackingLoadFailure(
  category: TrackingLoadFailureCategory,
  statementStatus?: "ERR",
): TrackingLoadError {
  return new TrackingLoadError(category, statementStatus);
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

const initializedCallers = new WeakMap<CredentialCaller, Promise<void>>();

async function runSchemaQuery(
  caller: CredentialCaller,
  query: string,
  failureCategory: "schema_inspection_failed" | "schema_creation_failed",
): Promise<{ status: string; result: unknown }> {
  let response: DatabaseQueryResult;
  try {
    response = await caller.databaseQuery(query);
  } catch {
    throw trackingLoadFailure(failureCategory);
  }

  if (!response || !Array.isArray(response.results) || response.results.length !== 1) {
    throw trackingLoadFailure("schema_response_invalid");
  }

  const [statement] = response.results;
  if (!isRecord(statement) || typeof statement.status !== "string") {
    throw trackingLoadFailure("schema_response_invalid");
  }

  return { status: statement.status, result: statement.result };
}

function hasTrackingTable(schema: unknown): boolean {
  if (!isRecord(schema) || !isRecord(schema.tables)) {
    throw trackingLoadFailure("schema_response_invalid");
  }
  return Object.prototype.hasOwnProperty.call(schema.tables, TRACKING_TABLE);
}

async function initializeTrackingTable(caller: CredentialCaller): Promise<void> {
  const schema = await runSchemaQuery(caller, TRACKING_SCHEMA_QUERY, "schema_inspection_failed");
  if (schema.status !== "OK") {
    throw trackingLoadFailure(
      "schema_inspection_failed",
      schema.status === "ERR" ? "ERR" : undefined,
    );
  }
  if (hasTrackingTable(schema.result)) return;

  const created = await runSchemaQuery(
    caller,
    CREATE_TRACKING_TABLE_QUERY,
    "schema_creation_failed",
  );
  if (created.status === "OK") return;

  // Another manager tab may have initialized the table after our schema check.
  // Recheck before reporting a create error so startup remains safe under that race.
  try {
    const latestSchema = await runSchemaQuery(
      caller,
      TRACKING_SCHEMA_QUERY,
      "schema_inspection_failed",
    );
    if (latestSchema.status === "OK" && hasTrackingTable(latestSchema.result)) return;
  } catch {
    // Preserve the actionable table-creation category below.
  }
  throw trackingLoadFailure("schema_creation_failed", "ERR");
}

function ensureTrackingTable(caller: CredentialCaller): Promise<void> {
  const existing = initializedCallers.get(caller);
  if (existing) return existing;

  const initialization = initializeTrackingTable(caller);
  const cached = initialization.catch((error: unknown) => {
    initializedCallers.delete(caller);
    const failure =
      error instanceof TrackingLoadError ? error : trackingLoadFailure("schema_inspection_failed");
    console.error("[credential-manager] tracking initialization failed", failure.diagnostics());
    throw failure;
  });
  initializedCallers.set(caller, cached);
  return cached;
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
    await ensureTrackingTable(caller);
    const response = await caller.databaseQuery(LIST_QUERY);
    if (!response || !Array.isArray(response.results) || response.results.length !== 1) {
      throw trackingLoadFailure("invalid_response");
    }

    const [statement] = response.results;
    if (!isRecord(statement)) throw trackingLoadFailure("invalid_response");
    if (statement.status !== "OK") {
      throw trackingLoadFailure("statement_error", statement.status === "ERR" ? "ERR" : undefined);
    }
    if (!Array.isArray(statement.result)) throw trackingLoadFailure("invalid_response");

    try {
      return statement.result.map(parseRow);
    } catch {
      throw trackingLoadFailure("invalid_data");
    }
  } catch (error) {
    const failure =
      error instanceof TrackingLoadError ? error : trackingLoadFailure("request_rejected");
    if (!failure.category.startsWith("schema_")) {
      console.error("[credential-manager] tracking load failed", failure.diagnostics());
    }
    throw failure;
  }
}

export async function upsertTracked(
  caller: CredentialCaller,
  target: CredentialTarget,
  username: string,
): Promise<TrackedCredential> {
  await ensureTrackingTable(caller);
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
  await ensureTrackingTable(caller);
  statementResult(
    await caller.databaseQuery("DELETE type::record('credential_tracking', $key)", {
      key: trackingKey(target),
    }),
  );
}
