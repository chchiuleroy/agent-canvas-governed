/**
 * Mirrors the agent-server's `GET /api/governance/status` response
 * (openhands-sdk-governed `governance_router.py`).
 */
export interface GovernanceCentralApiStatus {
  /** `null` when the central API client is not configured (not probed). */
  reachable: boolean | null;
  /** `null` when the API was unreachable or not probed. */
  credentials_ok: boolean | null;
  /** Short, secret-free reason: an exception class name or an HTTP status. */
  error: string | null;
  checked_at: string;
}

export interface GovernanceStatus {
  deployment_mode: "personal" | "team";
  /** Team-mode env var names still unset (names only, never values). */
  missing_settings: string[];
  /** Present only in team mode. */
  central_api: GovernanceCentralApiStatus | null;
}
