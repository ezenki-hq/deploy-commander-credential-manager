import type { JSONValue } from "@ezenki/deploy-commander-installer-interface";
import { normalizePrefix, normalizeUsername, validateSecret } from "./input";
import { deleteTracked, upsertTracked } from "./tracking";
import type {
  CredentialCaller,
  CredentialTarget,
  OperationOutcome,
  TrackingMutation,
} from "./types";

type PlatformBatchResult = Awaited<ReturnType<CredentialCaller["addPlatformCredentials"]>>;
type PlatformItemResult = PlatformBatchResult["results"][number];

const codeMessages: Record<string, string> = {
  invalid_entry: "Check the registry prefix, username, and secret, then try again.",
  unknown_platform: "The agent does not have a Docker platform registered.",
  operation_failed: "The agent could not apply the Docker credential.",
  forbidden: "This manager is not permitted to change Docker credentials.",
};

function normalizedTarget(target: CredentialTarget): CredentialTarget {
  return target.kind === "prefix"
    ? { kind: "prefix", prefix: normalizePrefix(target.prefix) }
    : target;
}

function platformItemError(item: PlatformItemResult | undefined): Error {
  const message = item?.code ? codeMessages[item.code] : undefined;
  return new Error(message ?? "The agent could not apply the Docker credential.");
}

function assertSuccessfulItem(result: PlatformBatchResult): void {
  if (!Array.isArray(result?.results) || result.results.length !== 1) {
    throw new Error("The agent returned an invalid Docker credential result.");
  }

  const [item] = result.results;
  if (item.index !== 0 || item.status !== "ok") throw platformItemError(item);
}

async function writePlatformCredential(
  caller: CredentialCaller,
  credential: JSONValue,
): Promise<void> {
  let result: PlatformBatchResult;
  try {
    result = await caller.addPlatformCredentials([{ platform: "docker", credential }]);
  } catch {
    throw new Error("The agent could not apply the Docker credential.");
  }
  assertSuccessfulItem(result);
}

async function removePlatformCredential(
  caller: CredentialCaller,
  target: CredentialTarget,
): Promise<void> {
  const selector: { kind: "docker_hub" } | { kind: "prefix"; prefix: string } =
    target.kind === "docker_hub"
      ? { kind: "docker_hub" }
      : { kind: "prefix", prefix: target.prefix };

  let result: Awaited<ReturnType<CredentialCaller["removePlatformCredentials"]>>;
  try {
    result = await caller.removePlatformCredentials([{ platform: "docker", selector }]);
  } catch {
    throw new Error("The agent could not remove the Docker credential.");
  }

  if (!Array.isArray(result?.results) || result.results.length !== 1) {
    throw new Error("The agent returned an invalid Docker credential result.");
  }
  const [item] = result.results;
  if (item.index !== 0 || item.status !== "ok") {
    const error = platformItemError(item);
    if (item.code === "operation_failed") {
      throw new Error("The agent could not remove the Docker credential.");
    }
    throw error;
  }
}

export async function saveCredential(
  caller: CredentialCaller,
  target: CredentialTarget,
  rawUsername: string,
  rawSecret: string,
): Promise<OperationOutcome> {
  const normalized = normalizedTarget(target);
  const username = normalizeUsername(rawUsername);
  const secret = validateSecret(rawSecret);
  const auth = { kind: "basic", username, password: secret };
  let credential: JSONValue;
  if (normalized.kind === "docker_hub") {
    credential = { kind: "docker_hub", auth };
  } else {
    credential = { kind: "prefix", prefix: normalized.prefix, auth };
  }

  await writePlatformCredential(caller, credential);

  const pending: TrackingMutation = { kind: "upsert", target: normalized, username };
  try {
    await upsertTracked(caller, normalized, username);
    return { kind: "success" };
  } catch {
    return { kind: "tracking_failed", pending };
  }
}

export async function removeCredential(
  caller: CredentialCaller,
  target: CredentialTarget,
): Promise<OperationOutcome> {
  const normalized = normalizedTarget(target);
  await removePlatformCredential(caller, normalized);

  const pending: TrackingMutation = { kind: "delete", target: normalized };
  try {
    await deleteTracked(caller, normalized);
    return { kind: "success" };
  } catch {
    return { kind: "tracking_failed", pending };
  }
}

export async function retryTracking(
  caller: CredentialCaller,
  pending: TrackingMutation,
): Promise<void> {
  if (pending.kind === "upsert") {
    await upsertTracked(caller, pending.target, pending.username);
  } else {
    await deleteTracked(caller, pending.target);
  }
}
