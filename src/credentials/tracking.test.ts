import { afterEach, describe, expect, it, vi } from "vitest";
import type { CredentialCaller } from "./types";
import { deleteTracked, listTracked, upsertTracked } from "./tracking";

type DatabaseQueryResult = Awaited<ReturnType<CredentialCaller["databaseQuery"]>>;

afterEach(() => vi.restoreAllMocks());

const queryResult = (status: "OK" | "ERR", result: unknown): DatabaseQueryResult => ({
  results: [{ statement: 0, status, time: "1ms", result }],
});

const createCaller = (response: DatabaseQueryResult) => {
  const databaseQuery = vi.fn().mockResolvedValue(response);
  const caller = { databaseQuery } as unknown as CredentialCaller;
  return { caller, databaseQuery };
};

describe("listTracked", () => {
  it("parses Docker Hub and prefix tracking rows", async () => {
    const { caller } = createCaller(
      queryResult("OK", [
        {
          scope: "docker_hub",
          prefix: null,
          username: "robot",
          updated_at: "2026-09-26T00:00:00Z",
        },
        {
          scope: "prefix",
          prefix: "ghcr.io/team",
          username: "team-robot",
          updated_at: "2026-09-26T01:00:00Z",
        },
      ]),
    );

    await expect(listTracked(caller)).resolves.toEqual([
      {
        target: { kind: "docker_hub" },
        username: "robot",
        updatedAt: "2026-09-26T00:00:00Z",
      },
      {
        target: { kind: "prefix", prefix: "ghcr.io/team" },
        username: "team-robot",
        updatedAt: "2026-09-26T01:00:00Z",
      },
    ]);
  });

  it("rejects malformed rows instead of hiding them", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { caller } = createCaller(
      queryResult("OK", [{ scope: "prefix", prefix: null, username: "robot", updated_at: "now" }]),
    );

    await expect(listTracked(caller)).rejects.toMatchObject({ category: "invalid_data" });
    expect(logger).toHaveBeenCalledWith("[credential-manager] tracking load failed", {
      category: "invalid_data",
      message: "Tracking records contain unsupported data.",
    });
  });

  it("rejects statement errors returned in a resolved query", async () => {
    const { caller } = createCaller(queryResult("ERR", "database policy error"));

    await expect(listTracked(caller)).rejects.toThrow();
  });

  it("logs categorized read failures with safe diagnostic detail only", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { caller, databaseQuery } = createCaller(queryResult("OK", []));
    databaseQuery.mockRejectedValueOnce({
      code: "DB_DENIED",
      message: "Manager database query was denied; token=do-not-log-this",
      details: { password: "do-not-log-this" },
    });

    await expect(listTracked(caller)).rejects.toMatchObject({
      category: "request_rejected",
      message: "Manager database query was denied; token=[redacted]",
    });

    expect(logger).toHaveBeenCalledWith("[credential-manager] tracking load failed", {
      category: "request_rejected",
      code: "DB_DENIED",
      message: "Manager database query was denied; token=[redacted]",
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("do-not-log-this");
  });

  it("exposes statement errors as categorized tracking load failures", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { caller } = createCaller(
      queryResult("ERR", { code: "TABLE_ERROR", message: "Tracking query failed" }),
    );

    await expect(listTracked(caller)).rejects.toMatchObject({
      category: "statement_error",
      code: "TABLE_ERROR",
      message: "Tracking query failed",
    });

    expect(logger).toHaveBeenCalledWith("[credential-manager] tracking load failed", {
      category: "statement_error",
      code: "TABLE_ERROR",
      message: "Tracking query failed",
    });
  });
});

describe("upsertTracked", () => {
  it("binds only metadata and normalizes prefix keys", async () => {
    const { caller, databaseQuery } = createCaller(
      queryResult("OK", [
        {
          scope: "prefix",
          prefix: "ghcr.io/team",
          username: "robot",
          updated_at: "2026-09-26T00:00:00Z",
        },
      ]),
    );

    await upsertTracked(caller, { kind: "prefix", prefix: " GHCR.IO/team " }, "robot");

    expect(databaseQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPSERT type::record('credential_tracking', $key)"),
      { key: "prefix:ghcr.io/team", scope: "prefix", prefix: "ghcr.io/team", username: "robot" },
    );
  });

  it("uses a fixed key for Docker Hub", async () => {
    const { caller, databaseQuery } = createCaller(
      queryResult("OK", [
        {
          scope: "docker_hub",
          prefix: null,
          username: "robot",
          updated_at: "2026-09-26T00:00:00Z",
        },
      ]),
    );

    await upsertTracked(caller, { kind: "docker_hub" }, "robot");

    expect(databaseQuery).toHaveBeenCalledWith(expect.any(String), {
      key: "docker_hub",
      scope: "docker_hub",
      prefix: null,
      username: "robot",
    });
  });
});

describe("deleteTracked", () => {
  it("uses the normalized upsert key to remove a prefix record", async () => {
    const { caller, databaseQuery } = createCaller(queryResult("OK", []));

    await expect(
      deleteTracked(caller, { kind: "prefix", prefix: "GHCR.IO/team" }),
    ).resolves.toBeUndefined();

    expect(databaseQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE type::record('credential_tracking', $key)"),
      { key: "prefix:ghcr.io/team" },
    );
  });
});
