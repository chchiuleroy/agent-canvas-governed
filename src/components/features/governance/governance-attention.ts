import { I18nKey } from "#/i18n/declaration";
import type {
  GovernanceAttentionAction,
  GovernanceAttentionItem,
  GovernanceAttentionOutcome,
} from "#/types/governance";

/** The order buttons appear in; also the only actions the UI knows how to run. */
const ACTION_ORDER: readonly GovernanceAttentionAction[] = [
  "retry",
  "abandon",
  "dismiss",
];

/**
 * The actions to offer for an item: what the SERVER allows, narrowed to the
 * actions this UI can run. Nothing is decided here: an action the server did
 * not list never becomes a button, and one it listed that this UI does not know
 * is ignored rather than guessed at.
 */
export function visibleActions(
  item: Pick<GovernanceAttentionItem, "allowed_actions">,
): GovernanceAttentionAction[] {
  return ACTION_ORDER.filter((action) => item.allowed_actions.includes(action));
}

const OUTCOME_ORDER: readonly GovernanceAttentionOutcome[] = [
  "confirmed_executed",
  "confirmed_not_executed",
  "inconclusive",
];

/**
 * The outcomes to offer with a dismiss: what the SERVER allows for this record
 * (none from an older server, and none where the action cannot have run),
 * narrowed to the ones this UI can send.
 */
export function visibleOutcomes(
  item: Pick<GovernanceAttentionItem, "allowed_outcomes">,
): GovernanceAttentionOutcome[] {
  const allowed = item.allowed_outcomes ?? [];
  return OUTCOME_ORDER.filter((outcome) => allowed.includes(outcome));
}

export const OUTCOME_LABEL: Record<GovernanceAttentionOutcome, I18nKey> = {
  confirmed_executed: I18nKey.GOVERNANCE$ATTENTION_OUTCOME_CONFIRMED_EXECUTED,
  confirmed_not_executed:
    I18nKey.GOVERNANCE$ATTENTION_OUTCOME_CONFIRMED_NOT_EXECUTED,
  inconclusive: I18nKey.GOVERNANCE$ATTENTION_OUTCOME_INCONCLUSIVE,
};

const REASON_TEXT: Record<string, I18nKey> = {
  claim_failed: I18nKey.GOVERNANCE$ATTENTION_REASON_CLAIM_FAILED,
  claim_transient: I18nKey.GOVERNANCE$ATTENTION_REASON_CLAIM_TRANSIENT,
  claim_retry_failed: I18nKey.GOVERNANCE$ATTENTION_REASON_CLAIM_RETRY_FAILED,
  report_failed: I18nKey.GOVERNANCE$ATTENTION_REASON_REPORT_FAILED,
  approval_cancelled_or_expired:
    I18nKey.GOVERNANCE$ATTENTION_REASON_APPROVAL_CANCELLED_OR_EXPIRED,
  central_status_unexpected:
    I18nKey.GOVERNANCE$ATTENTION_REASON_CENTRAL_STATUS_UNEXPECTED,
  reconcile_failed: I18nKey.GOVERNANCE$ATTENTION_REASON_RECONCILE_FAILED,
  binding_report_failed:
    I18nKey.GOVERNANCE$ATTENTION_REASON_BINDING_REPORT_FAILED,
  late_report_refused: I18nKey.GOVERNANCE$ATTENTION_REASON_LATE_REPORT_REFUSED,
  unreadable_outbox: I18nKey.GOVERNANCE$ATTENTION_REASON_UNREADABLE_OUTBOX,
};

/**
 * Which explanation to show for a reason. A reason this app does not know (or
 * none at all, for a record parked before reasons were recorded) gets the
 * generic text, which says only that it can be marked as handled.
 */
export function reasonText(reason: string | null): {
  key: I18nKey;
  values?: { reason: string };
} {
  // `hasOwn`: a reason such as "constructor" must not find an inherited member.
  if (reason !== null && Object.hasOwn(REASON_TEXT, reason)) {
    return { key: REASON_TEXT[reason] };
  }
  return {
    key: I18nKey.GOVERNANCE$ATTENTION_REASON_UNKNOWN,
    values: { reason: reason ?? "none" },
  };
}

export const ACTION_LABEL: Record<GovernanceAttentionAction, I18nKey> = {
  retry: I18nKey.GOVERNANCE$ATTENTION_ACTION_RETRY,
  abandon: I18nKey.GOVERNANCE$ATTENTION_ACTION_ABANDON,
  dismiss: I18nKey.GOVERNANCE$ATTENTION_ACTION_DISMISS,
};

export const ACTION_EFFECT: Record<GovernanceAttentionAction, I18nKey> = {
  retry: I18nKey.GOVERNANCE$ATTENTION_EFFECT_RETRY,
  abandon: I18nKey.GOVERNANCE$ATTENTION_EFFECT_ABANDON,
  dismiss: I18nKey.GOVERNANCE$ATTENTION_EFFECT_DISMISS,
};

/** Same limits as the server (`ResolveRequest.operator`); the server decides. */
export const MAX_OPERATOR_CHARS = 64;

/**
 * The operator name as it will be sent, or `null` if it is not acceptable.
 * Mirrors the server's rule (1 to 64 characters after trimming, nothing
 * invisible) only so the confirm button can stay disabled; a name this accepts
 * and the server refuses comes back as an "invalid" error, which is handled.
 */
export function cleanOperator(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || [...name].length > MAX_OPERATOR_CHARS) return null;
  // Control, format (zero-width), separator-other-than-space and unassigned.
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(name)) return null;
  return name;
}

export type ResolveFailure = "stale" | "central" | "invalid" | "other";

/** A refused resolve, as the dialog should present it. */
export function classifyResolveFailure(
  status: number | null,
  errorCode: string | null,
): ResolveFailure {
  if (status === 422) return "invalid";
  if (status === 424) return "central";
  if (
    status === 404 ||
    errorCode === "state_changed" ||
    errorCode === "request_id_mismatch" ||
    errorCode === "action_not_allowed" ||
    errorCode === "outcome_not_allowed"
  ) {
    return "stale";
  }
  return "other";
}

const OPERATOR_STORAGE_KEY = "governance-attention-operator";

/** What the operator typed last time. Storage may be unavailable: then nothing. */
export function rememberedOperator(): string {
  try {
    return window.localStorage.getItem(OPERATOR_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberOperator(name: string): void {
  try {
    window.localStorage.setItem(OPERATOR_STORAGE_KEY, name);
  } catch {
    // Not remembered; the field is simply empty next time.
  }
}
