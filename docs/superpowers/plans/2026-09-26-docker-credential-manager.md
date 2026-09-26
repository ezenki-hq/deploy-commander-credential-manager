# Docker Credential Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Deploy Commander manager UI that sets and removes basic Docker Hub and registry-prefix credentials while tracking only metadata in the manager database.

**Architecture:** A React/TypeScript interface owns one Deploy Commander wire and caller. Pure input validation feeds a platform-credential operation service; after a successful platform response, a separate SurrealDB adapter updates the manager's tracking records. Tailwind styles the UI, and Prettier checks the project.

**Tech Stack:** React, TypeScript, Vite, `@ezenki/deploy-commander-installer-interface@^0.6.0`, Tailwind CSS with its Vite plugin, Vitest, Testing Library, Prettier, npm.

**Spec:** `docs/superpowers/specs/2026-09-26-docker-credential-manager-design.md`

## Global Constraints

- Use the package's React/TypeScript initializer as the project starting point. This repository is nonempty, so generate into an empty temporary directory and copy the generated app into the repo without copying `.env` or replacing `docs/`. The 0.6.0 noninteractive initializer requires Commander values; use clearly synthetic `https://commander.invalid`, `placeholder`, and `placeholder` values only for scaffolding.
- Use only `RPCCaller` for platform writes and manager database queries. Do not add direct Deploy Commander HTTP calls, custom credential APIs, or caller-selected current-manager IDs.
- Support basic auth only. The secret field may contain a password, personal access token, or other registry secret. No refresh containers or token-renewal flow.
- The manager database stores only scope, normalized prefix, username, and update time. Never pass a secret to `databaseQuery`, put it in `deploy-commander.json`, log it, or render it in an error.
- Keep one Docker Hub record and one record per normalized prefix. The UI presents these as manager tracking records, since platform credentials cannot be read back.
- The publish configuration grants both `platform_credentials.add` and `platform_credentials.remove` for `docker`.

## File Map

- `src/commander/client.ts` owns wire creation and teardown; `src/main.tsx` creates one client and passes its caller to the app.
- `src/credentials/input.ts` owns pure validation and normalization; `types.ts` defines the shared target, caller, tracking, and outcome shapes.
- `src/credentials/tracking.ts` alone reads and writes manager database metadata.
- `src/credentials/operations.ts` alone sequences platform writes and tracking mutations.
- `src/App.tsx` owns page state; `src/components/` contains the reusable form and confirmation dialog.
- `src/index.css` holds Tailwind imports and minimal global styling; build, publish, test, and format configuration stay at the repo root.

## Review Focus

- A whitespace-only secret must fail validation, while leading/trailing spaces in a nonblank secret remain unchanged: Task 2 test.
- Host casing variants such as `GHCR.IO/team` and `ghcr.io/team` must map to one tracking key: Task 2 test.
- A resolved `databaseQuery` containing a statement with `status: "ERR"` must fail visibly: Task 3 test.
- A resolved platform batch with no result, wrong index, or `status: "error"` must never mutate tracking: Task 4 test.
- A successful platform removal followed by a database failure must expose a metadata-only retry that does not repeat the platform operation: Task 4 test.

---

### Task 1: Project foundation and Commander lifetime

**Files:** Create/modify `package.json`, `package-lock.json`, `vite.config.ts`, `deploy-commander.json`, `.gitignore`, `.prettierrc.json`, `.prettierignore`, `src/index.css`, `src/main.tsx`, `src/App.tsx`; create `src/commander/client.ts`, `src/commander/client.test.ts`, `src/test/setup.ts`; delete generated `src/deployCommander.ts` and `src/styles.css` after replacing their uses.

**Interfaces:** Produce `createCommanderClient(): { caller: RPCCaller; dispose(): void }` in `src/commander/client.ts`. Later tasks receive `caller`; only `main.tsx` creates the client. The incoming wire handler returns a structured unsupported-request response. `dispose()` calls `wire.end()` once.

- [ ] **Step 1: Scaffold the project.** Run `npx @ezenki/deploy-commander-installer-interface@0.6.0 init <empty-temp-directory> --framework react --language typescript --manager-name deploy-commander-credential-manager --package-manager npm --no-install` with the synthetic `COMMANDER_*` values in Global Constraints; copy its app files into this repo, excluding `.env` and preserving `docs/`.
- [ ] **Step 2: Install dependencies.** Run `npm install`; add `tailwindcss`, `@tailwindcss/vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, and `@testing-library/jest-dom` as development dependencies.
- [ ] **Step 3: Configure tools and publishing.** Add Tailwind through `@tailwindcss/vite` and `@import "tailwindcss"` following the [official Vite integration](https://tailwindcss.com/docs/installation/using-vite). Configure Vitest with jsdom and `src/test/setup.ts`. Preserve generated Prettier `format`/`format:check` scripts and config, and add a `test` script. Ignore existing `docs/` in `.prettierignore`. Set publish permissions to `{"platform_credentials":{"add":["docker"],"remove":["docker"]}}` without credential values.
- [ ] **Step 4: Write a failing client test.** Mock `createWire` and `RPC.SetupRPCCaller`; use the assertions below.

  ```ts
  it("creates one wire and disposes it once", () => {
    const client = createCommanderClient();
    expect(createWire).toHaveBeenCalledTimes(1);
    client.dispose();
    client.dispose();
    expect(end).toHaveBeenCalledTimes(1);
  });
  it("rejects unknown incoming calls", async () => {
    expect(await incoming({ request: "unknown" })).toMatchObject({ ok: false });
  });
  ```

- [ ] **Step 5: Run `npx vitest run src/commander/client.test.ts`.** Expect failure because `createCommanderClient` does not exist yet.
- [ ] **Step 6: Implement the client and mount the placeholder app.** Create the wire once at app bootstrap in `main.tsx`, pass the caller to `App`, and dispose it on page teardown. Replace the generated `StrictMode` bootstrap so development remounts do not end the active wire. Remove the superseded generated connector and stylesheet. Keep the generated `dev`, `build`, and `publish:manager` scripts.
- [ ] **Step 7: Run `npm run format`, `npx vitest run src/commander/client.test.ts`, `npm run build`, and `npm run format:check`.** Expect all verification commands to pass.
- [ ] **Step 8: Commit** foundation and tooling files.

### Task 2: Basic input and prefix normalization

**Files:** Create `src/credentials/types.ts`, `src/credentials/input.ts`, `src/credentials/input.test.ts`.

**Interfaces:** Define `CredentialTarget = { kind: "docker_hub" } | { kind: "prefix"; prefix: string }` and `CredentialCaller = Pick<RPCCaller, "databaseQuery" | "addPlatformCredentials" | "removePlatformCredentials">` in `types.ts`. Export `normalizePrefix(raw: string): string`, `normalizeUsername(raw: string): string`, and `validateSecret(raw: string): string` from `input.ts`; each rejects invalid input with a safe validation message.

- [ ] **Step 1: Write failing tests.** Name the valid, invalid, and secret cases and include these assertions:

  ```ts
  expect(normalizePrefix(" GHCR.IO/Team ")).toBe("ghcr.io/Team");
  expect(normalizePrefix("ghcr.io/team")).toBe(normalizePrefix("GHCR.IO/team"));
  for (const value of ["https://ghcr.io/team", "ghcr.io/team/", "ghcr.io/team?x=1", "/team", "ghcr.io/a b"]) {
    expect(() => normalizePrefix(value)).toThrow();
  }
  expect(() => normalizeUsername("  ")).toThrow();
  expect(() => validateSecret("  ")).toThrow();
  expect(validateSecret(" token with spaces ")).toBe(" token with spaces ");
  ```
- [ ] **Step 2: Run `npx vitest run src/credentials/input.test.ts`.** Expect failure for missing exports.
- [ ] **Step 3: Implement validation.** Trim outer prefix/username whitespace; lowercase only the registry host; preserve path case and all nonblank secret bytes. Ensure a host casing variant produces the same normalized prefix.
- [ ] **Step 4: Run the targeted test and `npm run build`.** Expect both to pass.
- [ ] **Step 5: Commit** the input module and tests.

### Task 3: Metadata-only tracking adapter

**Files:** Create `src/credentials/tracking.ts`, `src/credentials/tracking.test.ts`; extend `src/credentials/types.ts`.

**Interfaces:** Define `TrackedCredential = { target: CredentialTarget; username: string; updatedAt: string }` and `TrackingMutation = { kind: "upsert"; target: CredentialTarget; username: string } | { kind: "delete"; target: CredentialTarget }`. Export `listTracked(caller: CredentialCaller): Promise<TrackedCredential[]>`, `upsertTracked(caller: CredentialCaller, target: CredentialTarget, username: string): Promise<TrackedCredential>`, and `deleteTracked(caller: CredentialCaller, target: CredentialTarget): Promise<void>`.

- [ ] **Step 1: Write failing adapter tests.** Use a fake `databaseQuery` and assert list parsing, malformed-row rejection, status inspection, and metadata-only bindings:

  ```ts
  expect(await listTracked(caller)).toEqual([{ target: { kind: "docker_hub" }, username: "robot", updatedAt: "2026-09-26T00:00:00Z" }]);
  await expect(listTracked(callerWithErrStatement)).rejects.toThrow();
  await upsertTracked(caller, { kind: "prefix", prefix: "ghcr.io/team" }, "robot");
  expect(databaseQuery).toHaveBeenCalledWith(expect.stringContaining("UPSERT"), expect.objectContaining({ key: "prefix:ghcr.io/team", username: "robot" }));
  ```

  Also test malformed rows and the `docker_hub` key; delete must use the same key as upsert.
- [ ] **Step 2: Run `npx vitest run src/credentials/tracking.test.ts`.** Expect failure for missing adapter functions.
- [ ] **Step 3: Implement the adapter.** Normalize prefix targets before forming keys. Use `SELECT scope, prefix, username, updated_at FROM credential_tracking` for listing, `UPSERT type::record('credential_tracking', $key) CONTENT ... updated_at: time::now()` for saving, and `DELETE type::record('credential_tracking', $key)` for removal. Pass all input values through bindings. Inspect every returned statement's status and validate result shapes. If the deployed SurrealDB version names `type::record` differently, use its equivalent record-ID function while retaining bound values and deterministic keys.
- [ ] **Step 4: Run the targeted test and `npm run build`.** Expect both to pass.
- [ ] **Step 5: Commit** the adapter and tests.

### Task 4: Platform writes and partial-success handling

**Files:** Create `src/credentials/operations.ts`, `src/credentials/operations.test.ts`; extend `src/credentials/types.ts`.

**Interfaces:** Define `OperationOutcome = { kind: "success" } | { kind: "tracking_failed"; pending: TrackingMutation }`. Export `saveCredential(caller: CredentialCaller, target: CredentialTarget, username: string, secret: string): Promise<OperationOutcome>`, `removeCredential(caller: CredentialCaller, target: CredentialTarget): Promise<OperationOutcome>`, and `retryTracking(caller: CredentialCaller, pending: TrackingMutation): Promise<void>`.

- [ ] **Step 1: Write failing operation tests.** Assert Hub and prefix payloads, sequencing, and partial success. Include these assertions in separately set up cases:

  ```ts
  for (const results of [[], [{ index: 1, status: "ok" }], [{ index: 0, status: "error", code: "forbidden" }]]) {
    caller.addPlatformCredentials.mockResolvedValueOnce({ results });
    await expect(saveCredential(caller, { kind: "docker_hub" }, "robot", "test-secret")).rejects.toThrow();
  }
  expect(caller.databaseQuery).not.toHaveBeenCalled();
  await saveCredential(successfulCaller, { kind: "docker_hub" }, "robot", "test-secret");
  expect(successfulCaller.addPlatformCredentials).toHaveBeenCalledWith([{
    platform: "docker",
    credential: { kind: "docker_hub", auth: { kind: "basic", username: "robot", password: "test-secret" } },
  }]);
  expect(JSON.stringify(successfulCaller.databaseQuery.mock.calls)).not.toContain("test-secret");
  const outcome = await removeCredential(callerWithTrackingFailure, { kind: "prefix", prefix: "ghcr.io/team" });
  expect(outcome).toMatchObject({ kind: "tracking_failed", pending: { kind: "delete" } });
  expect(JSON.stringify(outcome)).not.toContain("test-secret");
  if (outcome.kind !== "tracking_failed") throw new Error("expected tracking failure");
  await retryTracking(callerWithTrackingFailure, outcome.pending);
  expect(callerWithTrackingFailure.removePlatformCredentials).toHaveBeenCalledTimes(1);
  ```

  Test a thrown platform RPC the same way, and assert the exact basic-auth secret passes only to `addPlatformCredentials`.
- [ ] **Step 2: Run `npx vitest run src/credentials/operations.test.ts`.** Expect failure for missing operation functions.
- [ ] **Step 3: Implement the operation service.** Normalize/validate again at this boundary. Convert platform item codes to safe messages without rendering raw error details. Return a plain metadata-only `pending` value after a successful platform write and failed tracking write; do not put the secret in a closure used for retry.
- [ ] **Step 4: Run the targeted test and `npm run build`.** Expect both to pass.
- [ ] **Step 5: Commit** the service and tests.

### Task 5: Tailwind management UI and handoff documentation

**Files:** Replace `src/App.tsx`, `src/index.css`; create `src/components/CredentialForm.tsx`, `src/components/RemoveDialog.tsx`, `src/App.test.tsx`, `README.md`; update `src/main.tsx` if needed.

**Interfaces:** `App({ caller }: { caller: CredentialCaller })` loads `listTracked`, calls the operation service, and holds only disposable form and pending-mutation state. `CredentialForm` receives a target and submit callback. `RemoveDialog` receives the exact scope and confirm/cancel callbacks.

- [ ] **Step 1: Write failing UI tests.** Cover loading/error/empty/tracked states, required secret entry, removal, retry, and field clearing. Mock the caller/service at the boundary, not the form implementation. Include:

  ```tsx
  expect(screen.getByLabelText("Password, personal access token, or secret")).toHaveAttribute("type", "password");
  expect(screen.getByText(/docker\.io/)).toBeVisible();
  expect(screen.getByRole("dialog")).toHaveTextContent("ghcr.io/team");
  expect(screen.getByRole("status")).toHaveTextContent(/tracking/i);
  ```
- [ ] **Step 2: Run `npx vitest run src/App.test.tsx`.** Expect failures against the placeholder UI.
- [ ] **Step 3: Build the UI.** Use a calm neutral page, clear Docker Hub card, responsive prefix list, strong action hierarchy, visible focus rings, inline validation, and accessible status/error announcements. Disable duplicate submits while an operation is in progress. Show that records are tracked metadata and cannot reveal or verify existing secrets. Keep errors specific to platform versus tracking failure.
- [ ] **Step 4: Document operation.** Add README setup, `npm run dev`, test/build/format commands, required Docker grants, and the no-read limitation.
- [ ] **Step 5: Run `npm run format`, `npm test`, `npm run build`, and `npm run format:check`.** Expect all verification commands to pass. Inspect the app at narrow and desktop widths if a browser preview is available.
- [ ] **Step 6: Commit** the UI and documentation.

## Final review

- [ ] Review the complete diff against the spec, including the five Review Focus cases and the `deploy-commander.json` grant shape.
- [ ] Run `npm test`, `npm run build`, `npm run format:check`, and `git diff --check`; record actual results before claiming completion.
- [ ] Confirm the manager database query bindings, published config, and build output contain no supplied secret. Report that live agent compatibility needs a Deploy Commander environment for an end-to-end check.
