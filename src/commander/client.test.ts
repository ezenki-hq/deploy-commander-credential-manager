import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCommanderClient } from "./client";

const mockWire = vi.hoisted(() => ({
  end: vi.fn(),
  handler: null as ((call: { request: string }) => Promise<unknown>) | null,
}));

vi.mock("@ezenki/deploy-commander-installer-interface", () => ({
  createWire: vi.fn((handler: (call: { request: string }) => Promise<unknown>) => {
    mockWire.handler = handler;
    return { end: mockWire.end };
  }),
  RPC: { SetupRPCCaller: vi.fn(() => ({ databaseQuery: vi.fn() })) },
}));

describe("createCommanderClient", () => {
  beforeEach(() => {
    mockWire.end.mockClear();
    mockWire.handler = null;
  });

  it("creates one wire and disposes it once", async () => {
    const { createWire } = await import("@ezenki/deploy-commander-installer-interface");
    const client = createCommanderClient();

    expect(createWire).toHaveBeenCalledTimes(1);
    client.dispose();
    client.dispose();
    expect(mockWire.end).toHaveBeenCalledTimes(1);
  });

  it("returns a structured failure for unsupported incoming calls", async () => {
    createCommanderClient();

    expect(mockWire.handler).not.toBeNull();
    await expect(mockWire.handler?.({ request: "unknown" })).resolves.toMatchObject({ ok: false });
  });
});
