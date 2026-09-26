import { describe, expect, it, vi } from "vitest";
import type { CredentialCaller } from "./types";
import { deleteTracked, listTracked, upsertTracked } from "./tracking";

type DatabaseQueryResult = Awaited<ReturnType<CredentialCaller["databaseQuery"]>>;

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
    const { caller } = createCaller(
      queryResult("OK", [{ scope: "prefix", prefix: null, username: "robot", updated_at: "now" }]),
    );

    await expect(listTracked(caller)).rejects.toThrow();
  });

  it("rejects statement errors returned in a resolved query", async () => {
    const { caller } = createCaller(queryResult("ERR", "database policy error"));

    await expect(listTracked(caller)).rejects.toThrow();
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
