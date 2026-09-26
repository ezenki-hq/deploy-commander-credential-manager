import type { RPCCaller } from "@ezenki/deploy-commander-installer-interface";

export type CredentialTarget = { kind: "docker_hub" } | { kind: "prefix"; prefix: string };

export type CredentialCaller = Pick<
  RPCCaller,
  "databaseQuery" | "addPlatformCredentials" | "removePlatformCredentials"
>;

export type TrackedCredential = {
  target: CredentialTarget;
  username: string;
  updatedAt: string;
};

export type TrackingMutation =
  | { kind: "upsert"; target: CredentialTarget; username: string }
  | { kind: "delete"; target: CredentialTarget };

export type OperationOutcome =
  { kind: "success" } | { kind: "tracking_failed"; pending: TrackingMutation };
