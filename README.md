# Docker Credential Manager

A Deploy Commander manager interface for setting Docker Hub and registry-prefix credentials on
the agent's Docker platform.

## Develop

```sh
npm install
npm run dev
```

Run checks with:

```sh
npm test
npm run build
npm run format:check
```

Use `npm run format` to apply Prettier formatting.

## Credential behavior

- The manager supports basic authentication for Docker Hub and registry prefixes.
- The secret field accepts an account password, personal access token, or another registry secret.
- The secret is sent through Deploy Commander's Docker platform credential RPC and is never saved in
  the manager's database.
- The manager database tracks scope, prefix, username, and update time only. The interface cannot
  read back or verify the agent's existing credential values. Enter a new secret whenever replacing
  a credential.
- The published manager needs both `platform_credentials.add` and
  `platform_credentials.remove` grants for the `docker` platform. These grants are configured in
  `deploy-commander.json`.

## Publish

Copy `.env.example` to `.env` and set `COMMANDER_URL`, `COMMANDER_USERNAME`, and
`COMMANDER_PASSWORD` to the Deploy Commander account used for publishing. `.env` is git-ignored.
Build and publish the already-built interface with:

```sh
npm run build
npm run publish:manager
```

`npm run deploy` runs both commands in sequence.
