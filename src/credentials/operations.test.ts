import { describe, expect, it, vi } from "vitest";
import type { CredentialCaller } from "./types";
import { removeCredential, retryTracking, saveCredential } from "./operations";

const successfulPlatformResult = { results: [{ index: 0, status: "ok" }] };
const successfulDatabaseResult = {
  results: [
    {
      statement: 0,
      status: "OK",
      time: "1ms",
      result: [
        {
          scope: "docker_hub",
          prefix: null,
          username: "robot",
          updated_at: "2026-09-26T00:00:00Z",
        },
      ],
    },
  ],
};

function createCaller() {
  const calls: string[] = [];
  const databaseQuery = vi.fn(async () => {
    calls.push("database");
    return successfulDatabaseResult;
  });
  const addPlatformCredentials = vi.fn(async () => {
    calls.push("add");
    return successfulPlatformResult;
  });
  const removePlatformCredentials = vi.fn(async () => {
    calls.push("remove");
    return successfulPlatformResult;
  });

  return {
    caller: {
      databaseQuery,
      addPlatformCredentials,
      removePlatformCredentials,
    } as unknown as CredentialCaller,
    calls,
    databaseQuery,
    addPlatformCredentials,
    removePlatformCredentials,
  };
}

describe("saveCredential", () => {
  it("sends Docker Hub basic auth before tracking metadata", async () => {
    const { caller, calls, addPlatformCredentials, databaseQuery } = createCaller();

    await expect(
      saveCredential(caller, { kind: "docker_hub" }, "robot", " token "),
    ).resolves.toEqual({ kind: "success" });

    expect(addPlatformCredentials).toHaveBeenCalledWith([
      {
        platform: "docker",
        credential: {
          kind: "docker_hub",
          auth: { kind: "basic", username: "robot", password: " token " },
        },
      },
    ]);
    expect(calls).toEqual(["add", "database"]);
    expect(JSON.stringify(databaseQuery.mock.calls)).not.toContain(" token ");
  });

  it("normalizes registry prefixes for the platform write", async () => {
    const { caller, addPlatformCredentials } = createCaller();

    await saveCredential(caller, { kind: "prefix", prefix: " GHCR.IO/team " }, "robot", "pat");

    expect(addPlatformCredentials).toHaveBeenCalledWith([
      {
        platform: "docker",
        credential: {
          kind: "prefix",
          prefix: "ghcr.io/team",
          auth: { kind: "basic", username: "robot", password: "pat" },
        },
      },
    ]);
  });

  const failedBatches: Array<Awaited<ReturnType<CredentialCaller["addPlatformCredentials"]>>> = [
    { results: [] },
    { results: [{ index: 1, status: "ok" }] },
    { results: [{ index: 0, status: "error", code: "forbidden" }] },
  ];

  it.each(failedBatches)("does not track a failed platform item: %j", async ({ results }) => {
    const { caller, databaseQuery, addPlatformCredentials } = createCaller();
    addPlatformCredentials.mockResolvedValueOnce({ results });

    await expect(
      saveCredential(caller, { kind: "docker_hub" }, "robot", "test-secret"),
    ).rejects.toThrow();
    expect(databaseQuery).not.toHaveBeenCalled();
  });

  it("does not expose a rejected RPC error that contains the submitted secret", async () => {
    const { caller, databaseQuery, addPlatformCredentials } = createCaller();
    addPlatformCredentials.mockRejectedValueOnce(new Error("failed with test-secret"));

    await expect(
      saveCredential(caller, { kind: "docker_hub" }, "robot", "test-secret"),
    ).rejects.not.toThrow("test-secret");
    expect(databaseQuery).not.toHaveBeenCalled();
  });

  it("returns a metadata-only retry when the tracking upsert fails", async () => {
    const { caller, databaseQuery, addPlatformCredentials } = createCaller();
    databaseQuery.mockRejectedValueOnce(new Error("database unavailable"));

    const outcome = await saveCredential(caller, { kind: "docker_hub" }, "robot", "test-secret");

    expect(outcome).toMatchObject({
      kind: "tracking_failed",
      pending: { kind: "upsert", target: { kind: "docker_hub" }, username: "robot" },
    });
    expect(JSON.stringify(outcome)).not.toContain("test-secret");
    expect(JSON.stringify(databaseQuery.mock.calls)).not.toContain("test-secret");

    databaseQuery.mockResolvedValueOnce(successfulDatabaseResult);
    if (outcome.kind !== "tracking_failed") throw new Error("expected tracking retry");
    await retryTracking(caller, outcome.pending);

    expect(addPlatformCredentials).toHaveBeenCalledTimes(1);
    expect(databaseQuery).toHaveBeenCalledTimes(2);
  });
});

describe("removeCredential", () => {
  it("returns a metadata-only retry without repeating a successful platform removal", async () => {
    const { caller, databaseQuery, removePlatformCredentials } = createCaller();
    databaseQuery.mockRejectedValueOnce(new Error("database unavailable"));

    const outcome = await removeCredential(caller, {
      kind: "prefix",
      prefix: "ghcr.io/team",
    });

    expect(outcome).toMatchObject({
      kind: "tracking_failed",
      pending: { kind: "delete", target: { kind: "prefix", prefix: "ghcr.io/team" } },
    });
    expect(JSON.stringify(outcome)).not.toContain("test-secret");

    databaseQuery.mockResolvedValueOnce({
      ...successfulDatabaseResult,
      results: [{ ...successfulDatabaseResult.results[0], result: [] }],
    });
    if (outcome.kind !== "tracking_failed") throw new Error("expected tracking retry");
    await retryTracking(caller, outcome.pending);

    expect(removePlatformCredentials).toHaveBeenCalledTimes(1);
    expect(databaseQuery).toHaveBeenCalledTimes(2);
  });
});
