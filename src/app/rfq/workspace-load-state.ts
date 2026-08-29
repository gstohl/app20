export type WorkspaceLoadState =
  | "loading"
  | "ready"
  | "stale/offline"
  | "storage-unavailable"
  | "local-deal-read-failed"
  | "quarantined";
