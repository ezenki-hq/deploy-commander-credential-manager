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
    const result = statementResult(await caller.databaseQuery(LIST_QUERY));
    if (!Array.isArray(result)) throw new Error("Credential tracking data is invalid.");
    return result.map(parseRow);
  } catch {
    throw new Error("Unable to load credential tracking records.");
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
