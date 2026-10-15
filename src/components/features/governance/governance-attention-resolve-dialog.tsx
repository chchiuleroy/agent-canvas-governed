import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import XMarkIcon from "#/icons/x-mark.svg?react";
import { GovernanceResolveError } from "#/api/governance-service/governance-service.api";
import { useResolveGovernanceAttention } from "#/hooks/query/use-governance-attention";
import { modalTitleLgMediumClassName } from "#/utils/modal-classes";
import type {
  GovernanceAttentionAction,
  GovernanceAttentionItem,
  GovernanceAttentionOutcome,
} from "#/types/governance";
import {
  ACTION_EFFECT,
  ACTION_LABEL,
  OUTCOME_LABEL,
  classifyResolveFailure,
  cleanOperator,
  reasonText,
  rememberedOperator,
  rememberOperator,
  type ResolveFailure,
  visibleOutcomes,
} from "./governance-attention";

const ERROR_TEXT: Record<ResolveFailure, I18nKey> = {
  stale: I18nKey.GOVERNANCE$ATTENTION_ERROR_STALE,
  central: I18nKey.GOVERNANCE$ATTENTION_ERROR_CENTRAL,
  invalid: I18nKey.GOVERNANCE$ATTENTION_ERROR_INVALID,
  other: I18nKey.GOVERNANCE$ATTENTION_ERROR_OTHER,
};

interface Props {
  /** The item as the operator saw it: its `request_id` is what gets quoted. */
  item: GovernanceAttentionItem;
  action: GovernanceAttentionAction;
  onClose: () => void;
}

/**
 * Confirms one action on one parked record. Everything shown that came from the
 * server or from the operator is rendered as text, never as markup.
 */
export function GovernanceAttentionResolveDialog({
  item,
  action,
  onClose,
}: Props) {
  const { t } = useTranslation("openhands");
  const resolve = useResolveGovernanceAttention();
  const [operator, setOperator] = useState(rememberedOperator);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<GovernanceAttentionOutcome | "">("");
  const outcomes = action === "dismiss" ? visibleOutcomes(item) : [];
  const [failure, setFailure] = useState<{
    kind: ResolveFailure;
    code: string;
  } | null>(null);
  const [stillWaiting, setStillWaiting] = useState(false);

  const cleanName = cleanOperator(operator);
  const noteRequired = action === "dismiss";
  const trimmedNote = note.trim();
  const canConfirm =
    item.request_id !== null &&
    cleanName !== null &&
    (!noteRequired || trimmedNote.length > 0) &&
    !resolve.isPending &&
    !resolve.isSuccess;

  const reason = reasonText(item.reason);

  // Closing while the request runs would unmount the dialog before its result
  // arrives: the outcome (and the "still waiting" warning) would be lost.
  const close = () => {
    if (!resolve.isPending) onClose();
  };

  const confirm = () => {
    if (!canConfirm || cleanName === null || item.request_id === null) return;
    setFailure(null);
    resolve.mutate(
      {
        conversationId: item.conversation_id,
        body: {
          action,
          expected_request_id: item.request_id,
          operator: cleanName,
          ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
          ...(outcome !== "" ? { outcome } : {}),
        },
      },
      {
        onSuccess: (result) => {
          rememberOperator(cleanName);
          setStillWaiting(result.conversation_still_waiting === true);
        },
        onError: (error) => {
          const status =
            error instanceof GovernanceResolveError ? error.status : null;
          const code =
            error instanceof GovernanceResolveError ? error.errorCode : null;
          setFailure({
            kind: classifyResolveFailure(status, code),
            code: code ?? (status === null ? "?" : String(status)),
          });
        },
      },
    );
  };

  // In a portal: the sidebar is a containing block for fixed elements, so inside it
  // the overlay would be clipped to the sidebar instead of covering the window.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={close}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        role="presentation"
      />
      <div
        role="dialog"
        aria-modal="true"
        data-testid="governance-attention-resolve-dialog"
        className="relative w-full max-w-md rounded-xl border border-[var(--oh-border)] bg-[var(--oh-surface)] p-6"
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 text-muted hover:text-foreground"
          aria-label={t(I18nKey.BUTTON$CLOSE)}
        >
          <XMarkIcon className="size-5" />
        </button>

        <h2 className={modalTitleLgMediumClassName}>
          {t(ACTION_LABEL[action])}
        </h2>
        <p className="mt-1 break-all text-xs text-muted">
          {t(I18nKey.GOVERNANCE$ATTENTION_CONVERSATION)}: {item.conversation_id}
        </p>
        <p className="mt-3 text-sm">{t(reason.key, reason.values)}</p>
        <p className="mt-2 text-sm text-amber-400">
          {t(ACTION_EFFECT[action])}
        </p>

        {resolve.isSuccess ? (
          <div className="mt-4 text-sm" role="status">
            <p>{t(I18nKey.GOVERNANCE$ATTENTION_DONE)}</p>
            {stillWaiting ? (
              <p className="mt-2 text-amber-400">
                {t(I18nKey.GOVERNANCE$ATTENTION_STILL_WAITING)}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t(I18nKey.GOVERNANCE$ATTENTION_OPERATOR_LABEL)}
              <input
                data-testid="governance-attention-operator"
                value={operator}
                maxLength={256}
                onChange={(e) => setOperator(e.target.value)}
                className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm"
              />
              <span className="text-xs text-muted">
                {t(I18nKey.GOVERNANCE$ATTENTION_OPERATOR_HELP)}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {noteRequired
                ? t(I18nKey.GOVERNANCE$ATTENTION_NOTE_LABEL_REQUIRED)
                : t(I18nKey.GOVERNANCE$ATTENTION_NOTE_LABEL)}
              <textarea
                data-testid="governance-attention-note"
                value={note}
                maxLength={1000}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
                className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
            {outcomes.length > 0 ? (
              <label className="flex flex-col gap-1 text-sm">
                {t(I18nKey.GOVERNANCE$ATTENTION_OUTCOME_LABEL)}
                <select
                  data-testid="governance-attention-outcome"
                  value={outcome}
                  onChange={(e) =>
                    setOutcome(
                      e.target.value as GovernanceAttentionOutcome | "",
                    )
                  }
                  className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm"
                >
                  <option value="">
                    {t(I18nKey.GOVERNANCE$ATTENTION_OUTCOME_NONE)}
                  </option>
                  {outcomes.map((value) => (
                    <option key={value} value={value}>
                      {t(OUTCOME_LABEL[value])}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted">
                  {t(I18nKey.GOVERNANCE$ATTENTION_OUTCOME_HELP)}
                </span>
              </label>
            ) : null}
            {failure ? (
              <p
                role="alert"
                data-testid="governance-attention-error"
                data-kind={failure.kind}
                className="text-sm text-danger"
              >
                {t(ERROR_TEXT[failure.kind], { code: failure.code })}
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-[var(--oh-border)] px-4 py-2 text-sm text-white hover:bg-surface-raised"
          >
            {resolve.isSuccess
              ? t(I18nKey.BUTTON$CLOSE)
              : t(I18nKey.GOVERNANCE$ATTENTION_CANCEL)}
          </button>
          {resolve.isSuccess ? null : (
            <button
              type="button"
              data-testid="governance-attention-confirm"
              disabled={!canConfirm}
              onClick={confirm}
              className="rounded-lg bg-danger px-4 py-2 text-sm text-white hover:bg-danger/80 disabled:opacity-50"
            >
              {t(I18nKey.GOVERNANCE$ATTENTION_CONFIRM)}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
