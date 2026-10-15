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

/**
 * Mirrors the agent-server's `GET /api/governance/attention` items and
 * `POST /api/governance/attention/{id}/resolve` (openhands-sdk-governed
 * `governance_attention.py`). Everything here comes from the server or from
 * what an operator typed: render it as text only.
 */
export type GovernanceAttentionAction = "retry" | "abandon" | "dismiss";

/** What an operator who looked at central says happened to the action. */
export type GovernanceAttentionOutcome =
  | "confirmed_executed"
  | "confirmed_not_executed"
  | "inconclusive";

export interface GovernanceAttentionItem {
  conversation_id: string;
  /** `null` for a record parked before reasons were recorded. */
  reason: string | null;
  last_error_code: string | null;
  central_approval_id: string | null;
  /** `null` only for an unreadable outbox file. */
  request_id: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  /** What the server allows for this record; the UI offers nothing else. */
  allowed_actions: string[];
  /**
   * The outcomes that may accompany a dismiss, because the action may have run.
   * Absent from an older agent-server, and empty where there is nothing to say.
   */
  allowed_outcomes?: string[];
}

export interface GovernanceResolveRequest {
  action: GovernanceAttentionAction;
  /** The `request_id` of the item the operator was shown. */
  expected_request_id: string;
  note?: string;
  /** Self-declared, not authenticated. */
  operator: string;
  /** Dismiss only: filed with central first, as a statement in the operator's name. */
  outcome?: GovernanceAttentionOutcome;
}

export interface GovernanceResolveResponse {
  conversation_id: string;
  action: GovernanceAttentionAction;
  request_id: string;
  new_state: string;
  central_step: string;
  /**
   * Whether central was told what the operator did (an audit event). Best
   * effort: the action has happened either way. Absent from an older
   * agent-server.
   */
  central_audit?: "recorded" | "not_recorded" | "not_applicable";
  conversation_still_waiting: boolean | null;
}
