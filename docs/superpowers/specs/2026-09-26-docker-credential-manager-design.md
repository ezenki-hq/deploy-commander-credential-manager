# Docker Credential Manager Design

## Purpose and scope

Build a Deploy Commander manager interface for configuring basic authentication credentials used by an agent's Docker platform. It provides one Docker Hub credential and a list of registry-prefix credentials. A password field may contain an account password, a personal access token, or another secret accepted by the registry. The UI must say this clearly.

This is a new manager project in the repository. It has no credential refresh containers, token renewal flow, custom backend, or manager-to-manager credential API. The agent receives credentials through Deploy Commander's platform credential RPC; the manager interface is the configuration UI.

## Platform and storage boundaries

Create the manager with the guide's React and TypeScript initializer, using `@ezenki/deploy-commander-installer-interface`. Create one wire and one typed RPC caller for the interface lifetime. All platform credential and manager database operations go through that caller. The Deploy Commander host supplies the trusted current-manager identity. The published manager configuration requests both `add` and `remove` grants for the `docker` platform. It contains no credential values.

`addPlatformCredentials` creates or replaces an agent credential. `removePlatformCredentials` removes it. Each operation submits one scope at a time and checks the returned per-item status; a resolved RPC call can still contain an item error. The UI supports only `{ kind: "basic", username, password }` authentication. Docker Hub uses `kind: "docker_hub"`; registry entries use `kind: "prefix"` and a prefix without a URL scheme or trailing slash. Replacing a credential requires the user to enter a new password, token, or secret because there is no credential read operation.

The manager's isolated SurrealDB stores **tracking metadata only**: scope (`docker_hub` or `prefix`), normalized prefix when applicable, username, and last successful update time. It holds at most one Docker Hub record and one record for each normalized prefix. The password, personal access token, or secret is never a manager database field or query binding. The database does not claim to prove that the agent still holds a credential: another authorized actor may change the platform store outside this interface.

## User interface

Use Tailwind for a responsive, accessible settings page with a Docker Hub card and a registry-prefix list. The Hub card shows its tracked username and update time when present. The prefix list shows prefix, tracked username, and update time, with add, replace, and remove actions. Empty, loading, operation-in-progress, and error states are visible. A short explanation states that the list is this manager's tracking record and that existing secret values cannot be viewed.

All create and replace forms have username and a masked field labeled **Password, personal access token, or secret**. The field is required even when replacing an existing credential. The UI does not prefill it from storage. Prefix input is validated before submission: it must identify a registry host, optionally followed by a repository path, and must omit a URL scheme, trailing slash, query, fragment, and internal whitespace. Normalize by trimming outer whitespace and lowercasing the host while preserving the path's case. The normalized prefix is both the platform selector and the tracking key. Docker Hub matching applies to image names without an explicit registry host; explicit hosts, including `docker.io`, need a matching prefix. Confirm removal with the scope shown in the confirmation dialog.

Use Prettier for formatting, with project scripts to format files and check formatting. Keep generated build output, local `.env`, and secrets out of source control and out of the published bundle.

## Data and operation flow

On startup, initialize the wire and caller, then load tracking rows with a bound `databaseQuery`. Validate the shape of returned rows before rendering them. Inspect every database statement's `status`, since a query may resolve with an `ERR` statement. A database loading failure shows a retryable error rather than an empty credential list. The wire is ended on teardown.

For add or replace, validate the form, send the basic credential to `addPlatformCredentials`, inspect the item's result, then upsert only tracking metadata in the manager database. For removal, send the selector to `removePlatformCredentials`, inspect the item's result, then delete the tracking row. A failed platform operation leaves tracking unchanged. If the platform operation succeeds and the database operation fails, show an explicit partial-success warning: the platform operation happened, but tracking could not be updated. Offer a retry of the metadata operation while the page remains open; never imply that the stored secret was read back. Clear secret form input after the operation completes.

Database statements use bindings for user-controlled values. The service responsible for tracking never accepts a password field. Credential service functions never log secret-bearing payloads or include them in UI errors. Structured RPC errors are reduced to safe, useful messages; raw error details are not rendered.

## Verification and limits

Unit tests cover validation and normalization, parsing database results and statement errors, platform item errors, and the order and partial-success behavior of create, replace, and remove. Tests also establish that manager database calls contain only metadata and never the submitted secret. UI tests cover required secret entry on replacement, tracked versus empty states, accessible labels, removal confirmation, and failure messages. Run build, tests, and the Prettier check before completion.

The interface cannot list or retrieve credentials from the agent. Its records describe successful operations performed through this manager, subject to possible changes outside the interface. Any uncertainty after a partial failure must remain visible to the user until the metadata retry succeeds or the page is reloaded.
