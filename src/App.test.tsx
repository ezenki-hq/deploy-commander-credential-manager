import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialCaller, TrackedCredential } from "./credentials/types";
import App from "./App";

const services = vi.hoisted(() => ({
  listTracked: vi.fn(),
  saveCredential: vi.fn(),
  removeCredential: vi.fn(),
  retryTracking: vi.fn(),
}));

vi.mock("./credentials/tracking", () => ({ listTracked: services.listTracked }));
vi.mock("./credentials/operations", () => ({
  saveCredential: services.saveCredential,
  removeCredential: services.removeCredential,
  retryTracking: services.retryTracking,
}));

const hubRecord: TrackedCredential = {
  target: { kind: "docker_hub" },
  username: "hub-robot",
  updatedAt: "2026-09-26T00:00:00Z",
};

const prefixRecord: TrackedCredential = {
  target: { kind: "prefix", prefix: "ghcr.io/team" },
  username: "team-robot",
  updatedAt: "2026-09-26T01:00:00Z",
};

function renderApp() {
  return render(<App caller={{} as CredentialCaller} />);
}

describe("credential manager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    services.listTracked.mockResolvedValue([]);
    services.saveCredential.mockResolvedValue({ kind: "success" });
    services.removeCredential.mockResolvedValue({ kind: "success" });
    services.retryTracking.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("shows loading state while manager tracking is loading", () => {
    services.listTracked.mockReturnValue(new Promise(() => undefined));

    renderApp();

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("shows a retryable error instead of an empty list when loading fails", async () => {
    services.listTracked.mockRejectedValueOnce(new Error("database unavailable"));

    renderApp();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: /retry loading/i })).toBeVisible();
    expect(screen.queryByText(/no registry-prefix credentials tracked/i)).not.toBeInTheDocument();
  });

  it("shows empty Hub and prefix states when tracking loads with no rows", async () => {
    renderApp();

    expect(await screen.findByText(/no registry-prefix credentials tracked/i)).toBeVisible();
    expect(screen.getByText(/not tracked yet/i)).toBeVisible();
  });

  it("renders tracked Hub and prefix metadata without secret values", async () => {
    services.listTracked.mockResolvedValueOnce([hubRecord, prefixRecord]);

    renderApp();

    expect(await screen.findByText("hub-robot")).toBeVisible();
    expect(screen.getByText("team-robot")).toBeVisible();
    expect(screen.getByText("ghcr.io/team")).toBeVisible();
    expect(screen.getByText(/existing secret values cannot be viewed/i)).toBeVisible();
  });

  it("requires a new masked secret when replacing a tracked credential", async () => {
    const user = userEvent.setup();
    services.listTracked.mockResolvedValueOnce([hubRecord]);

    renderApp();
    await user.click(await screen.findByRole("button", { name: /replace docker hub credential/i }));

    const secret = screen.getByLabelText("Password, personal access token, or secret");
    expect(secret).toHaveAttribute("type", "password");
    expect(secret).toBeRequired();
    expect(secret).toHaveValue("");
    expect(screen.getByText(/docker\.io/)).toBeVisible();
  });

  it("clears the secret after a rejected platform operation", async () => {
    const user = userEvent.setup();
    services.saveCredential.mockRejectedValueOnce(
      new Error("Docker credential change was denied."),
    );

    renderApp();
    await user.click(await screen.findByRole("button", { name: /add docker hub credential/i }));
    await user.type(screen.getByLabelText("Username"), "robot");
    await user.type(
      screen.getByLabelText("Password, personal access token, or secret"),
      "test-secret",
    );
    await user.click(screen.getByRole("button", { name: /save credential/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Docker credential change was denied.",
    );
    expect(screen.getByLabelText("Password, personal access token, or secret")).toHaveValue("");
    expect(services.saveCredential).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "docker_hub" },
      "robot",
      "test-secret",
    );
  });

  it("keeps a partial-save warning until metadata retry succeeds", async () => {
    const user = userEvent.setup();
    services.saveCredential.mockResolvedValueOnce({
      kind: "tracking_failed",
      pending: { kind: "upsert", target: prefixRecord.target, username: "team-robot" },
    });
    services.listTracked.mockResolvedValueOnce([]).mockResolvedValueOnce([prefixRecord]);

    renderApp();
    await user.click(await screen.findByRole("button", { name: /add prefix credential/i }));
    await user.type(screen.getByLabelText("Registry host or prefix"), "ghcr.io/team");
    await user.type(screen.getByLabelText("Username"), "team-robot");
    await user.type(
      screen.getByLabelText("Password, personal access token, or secret"),
      "test-secret",
    );
    await user.click(screen.getByRole("button", { name: /save credential/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/agent credential was updated/i);
    expect(screen.getByRole("button", { name: /retry tracking update/i })).toBeVisible();
    expect(services.saveCredential).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /retry tracking update/i }));

    expect(services.retryTracking).toHaveBeenCalledWith(expect.anything(), {
      kind: "upsert",
      target: prefixRecord.target,
      username: "team-robot",
    });
    expect(services.saveCredential).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("team-robot")).toBeVisible();
  });

  it("confirms prefix removal with the exact scope", async () => {
    const user = userEvent.setup();
    services.listTracked.mockResolvedValueOnce([prefixRecord]);

    renderApp();
    await user.click(await screen.findByRole("button", { name: /remove ghcr.io\/team/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /ghcr.io\/team/ })).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(services.removeCredential).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /remove ghcr.io\/team/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /remove credential/i }),
    );

    expect(services.removeCredential).toHaveBeenCalledWith(expect.anything(), {
      kind: "prefix",
      prefix: "ghcr.io/team",
    });
    await waitFor(() =>
      expect(screen.getByText(/no registry-prefix credentials tracked/i)).toBeVisible(),
    );
  });
});
