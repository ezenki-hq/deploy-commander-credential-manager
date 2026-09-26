import type { RPCCaller } from "@ezenki/deploy-commander-installer-interface";

export type CredentialTarget = { kind: "docker_hub" } | { kind: "prefix"; prefix: string };

export type CredentialCaller = Pick<
  RPCCaller,
  "databaseQuery" | "addPlatformCredentials" | "removePlatformCredentials"
>;
