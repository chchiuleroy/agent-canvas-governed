import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GovernanceAttentionResolveDialog } from "#/components/features/governance/governance-attention-resolve-dialog";
import type {
  GovernanceAttentionAction,
  GovernanceAttentionItem,
} from "#/types/governance";

const mocks = vi.hoisted(() => ({ resolveAttention: vi.fn() }));
vi.mock("#/api/governance-service/governance-service.api", async () => {
  const actual = await vi.importActual<
    typeof import("#/api/governance-service/governance-service.api")
  >("#/api/governance-service/governance-service.api");
  return {
    ...actual,
    default: { ...actual.default, resolveAttention: mocks.resolveAttention },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${JSON.stringify(options)}` : key,
  }),
}));

const ITEM: GovernanceAttentionItem = {
  conversation_id: "11111111-1111-1111-1111-111111111111",
  reason: "claim_failed",
  last_error_code: "device_not_bound",
  central_approval_id: "a1",
  request_id: "req-1",
  attempt_count: 1,
  last_attempt_at: null,
  allowed_actions: ["retry", "abandon", "dismiss"],
};

const OK = {
  conversation_id: ITEM.conversation_id,
  action: "dismiss",
  request_id: "req-1",
  new_state: "resolved_manually",
  central_step: "not_applicable",
  conversation_still_waiting: false,
};

async function refusal(status: number, errorCode: string | null) {
  const { GovernanceResolveError } =
    await import("#/api/governance-service/governance-service.api");
  return new GovernanceResolveError(status, errorCode);
}

function setup(
  action: GovernanceAttentionAction,
  item: GovernanceAttentionItem = ITEM,
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <GovernanceAttentionResolveDialog
        item={item}
        action={action}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { invalidate, onClose };
}

const confirm = () => screen.getByTestId("governance-attention-confirm");
const typeOperator = (name: string) =>
  userEvent.type(screen.getByTestId("governance-attention-operator"), name);
const typeNote = (text: string) =>
  userEvent.type(screen.getByTestId("governance-attention-note"), text);

beforeEach(() => {
  mocks.resolveAttention.mockReset();
  window.localStorage.clear();
});

describe("GovernanceAttentionResolveDialog", () => {
  it("cannot be confirmed without an operator name", async () => {
    setup("retry");
    expect(confirm()).toBeDisabled();

    await typeOperator("   ");
    expect(confirm()).toBeDisabled();

    await typeOperator("ada");
    expect(confirm()).toBeEnabled();
  });

  it("needs a note to dismiss, but not to retry or abandon", async () => {
    setup("dismiss");
    await typeOperator("ada");
    expect(confirm()).toBeDisabled();
    await typeNote("   ");
    expect(confirm()).toBeDisabled();
    await typeNote("checked at central");
    expect(confirm()).toBeEnabled();
  });

  it.each(["retry", "abandon"] as const)(
    "%s works without a note",
    async (a) => {
      setup(a);
      await typeOperator("ada");
      expect(confirm()).toBeEnabled();
    },
  );

  it("sends the request_id of the item that was shown, the trimmed name and note", async () => {
    mocks.resolveAttention.mockResolvedValue(OK);
    setup("dismiss");
    await typeOperator("  ada ");
    await typeNote("  why  ");
    await userEvent.click(confirm());

    await waitFor(() => expect(mocks.resolveAttention).toHaveBeenCalled());
    expect(mocks.resolveAttention).toHaveBeenCalledWith(ITEM.conversation_id, {
      action: "dismiss",
      expected_request_id: "req-1",
      operator: "ada",
      note: "why",
    });
  });

  it("leaves the note out when there is none", async () => {
    mocks.resolveAttention.mockResolvedValue({ ...OK, action: "retry" });
    setup("retry");
    await typeOperator("ada");
    await userEvent.click(confirm());

    await waitFor(() => expect(mocks.resolveAttention).toHaveBeenCalled());
    expect(mocks.resolveAttention.mock.calls[0][1]).not.toHaveProperty("note");
  });

  it("will not act on a record that has no request_id", async () => {
    setup("dismiss", { ...ITEM, request_id: null });
    await typeOperator("ada");
    await typeNote("why");
    expect(confirm()).toBeDisabled();
  });

  it("remembers the name after a success, and offers it next time", async () => {
    mocks.resolveAttention.mockResolvedValue({ ...OK, action: "retry" });
    const first = setup("retry");
    await typeOperator("ada");
    await userEvent.click(confirm());
    await screen.findByText("GOVERNANCE$ATTENTION_DONE");
    expect(first.invalidate).toHaveBeenCalled();

    cleanup();
    setup("retry");
    expect(screen.getByTestId("governance-attention-operator")).toHaveValue(
      "ada",
    );
  });

  it("does not remember a name that was refused", async () => {
    mocks.resolveAttention.mockRejectedValue(await refusal(422, null));
    setup("retry");
    await typeOperator("ada");
    await userEvent.click(confirm());
    await screen.findByTestId("governance-attention-error");
    expect(
      window.localStorage.getItem("governance-attention-operator"),
    ).toBeNull();
  });

  it("warns when the conversation is still waiting on the action", async () => {
    mocks.resolveAttention.mockResolvedValue({
      ...OK,
      conversation_still_waiting: true,
    });
    setup("dismiss");
    await typeOperator("ada");
    await typeNote("why");
    await userEvent.click(confirm());
    expect(
      await screen.findByText("GOVERNANCE$ATTENTION_STILL_WAITING"),
    ).toBeVisible();
  });

  it("says so when central was not told what the operator did", async () => {
    mocks.resolveAttention.mockResolvedValue({
      ...OK,
      central_audit: "not_recorded",
    });
    setup("dismiss");
    await typeOperator("ada");
    await typeNote("why");
    await userEvent.click(confirm());
    expect(
      await screen.findByTestId("governance-attention-audit-missing"),
    ).toBeVisible();
    expect(
      screen.getByText("GOVERNANCE$ATTENTION_AUDIT_NOT_RECORDED"),
    ).toBeVisible();
    // the action is done: the dialog still says so
    expect(screen.getByText("GOVERNANCE$ATTENTION_DONE")).toBeVisible();
  });

  it.each(["recorded", "not_applicable", undefined])(
    "stays quiet about the audit when it is %s",
    async (audit) => {
      mocks.resolveAttention.mockResolvedValue({
        ...OK,
        ...(audit === undefined ? {} : { central_audit: audit }),
      });
      setup("dismiss");
      await typeOperator("ada");
      await typeNote("why");
      await userEvent.click(confirm());
      await screen.findByText("GOVERNANCE$ATTENTION_DONE");
      expect(
        screen.queryByTestId("governance-attention-audit-missing"),
      ).toBeNull();
    },
  );

  it("treats a stale refusal as stale, refreshes the list and changes nothing else", async () => {
    mocks.resolveAttention.mockRejectedValue(
      await refusal(409, "request_id_mismatch"),
    );
    const { invalidate } = setup("abandon");
    await typeOperator("ada");
    await userEvent.click(confirm());

    const error = await screen.findByTestId("governance-attention-error");
    expect(error).toHaveAttribute("data-kind", "stale");
    expect(invalidate).toHaveBeenCalled();
    // still open and still confirmable, so the operator can look and try again
    expect(confirm()).toBeEnabled();
  });

  it.each([
    [424, "central_failed", "central"],
    [422, null, "invalid"],
    [500, null, "other"],
  ] as const)("shows a %s refusal as %s", async (status, code, kind) => {
    mocks.resolveAttention.mockRejectedValue(await refusal(status, code));
    setup("retry");
    await typeOperator("ada");
    await userEvent.click(confirm());
    expect(
      await screen.findByTestId("governance-attention-error"),
    ).toHaveAttribute("data-kind", kind);
  });

  it("cannot be confirmed twice while the first request is running", async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.resolveAttention.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    setup("retry");
    await typeOperator("ada");
    await userEvent.click(confirm());
    await waitFor(() => expect(confirm()).toBeDisabled());
    await userEvent.click(confirm());
    expect(mocks.resolveAttention).toHaveBeenCalledTimes(1);
    finish({ ...OK, action: "retry" });
  });

  it("cannot be closed while the request is running, so its outcome is not lost", async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.resolveAttention.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { onClose } = setup("dismiss");
    await typeOperator("ada");
    await typeNote("why");
    await userEvent.click(confirm());
    await waitFor(() => expect(confirm()).toBeDisabled());

    await userEvent.click(screen.getByText("GOVERNANCE$ATTENTION_CANCEL"));
    await userEvent.click(screen.getByLabelText("BUTTON$CLOSE"));
    await userEvent.keyboard("{Escape}");
    document.querySelector<HTMLElement>("[role=presentation]")?.click();
    expect(onClose).not.toHaveBeenCalled();

    finish({ ...OK, conversation_still_waiting: true });
    expect(
      await screen.findByText("GOVERNANCE$ATTENTION_STILL_WAITING"),
    ).toBeVisible();
    // once it is finished the operator can close it
    await userEvent.click(screen.getByLabelText("BUTTON$CLOSE"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("GovernanceAttentionResolveDialog outcome", () => {
  const WITH_OUTCOMES: GovernanceAttentionItem = {
    ...ITEM,
    reason: "report_failed",
    allowed_outcomes: [
      "confirmed_executed",
      "confirmed_not_executed",
      "inconclusive",
    ],
  };
  const choose = (value: string) =>
    userEvent.selectOptions(
      screen.getByTestId("governance-attention-outcome"),
      value,
    );

  it("offers the choice only to a dismiss, and only if the server allows outcomes", () => {
    setup("dismiss", WITH_OUTCOMES);
    expect(
      screen.getByTestId("governance-attention-outcome"),
    ).toBeInTheDocument();
    cleanup();

    setup("dismiss", ITEM); // no allowed_outcomes
    expect(screen.queryByTestId("governance-attention-outcome")).toBeNull();
    cleanup();

    // the server would refuse an outcome with these, so the choice is not shown
    setup("retry", WITH_OUTCOMES);
    expect(screen.queryByTestId("governance-attention-outcome")).toBeNull();
    cleanup();
    setup("abandon", WITH_OUTCOMES);
    expect(screen.queryByTestId("governance-attention-outcome")).toBeNull();
  });

  it("labels each choice with its own outcome, and says it is a statement in a name not verified", async () => {
    setup("dismiss", WITH_OUTCOMES);
    const expected: Record<string, string> = {
      confirmed_executed: "GOVERNANCE$ATTENTION_OUTCOME_CONFIRMED_EXECUTED",
      confirmed_not_executed:
        "GOVERNANCE$ATTENTION_OUTCOME_CONFIRMED_NOT_EXECUTED",
      inconclusive: "GOVERNANCE$ATTENTION_OUTCOME_INCONCLUSIVE",
    };
    Object.entries(expected).forEach(([value, label]) => {
      expect(screen.getByRole("option", { name: label })).toHaveValue(value);
    });
    expect(screen.getByText("GOVERNANCE$ATTENTION_OUTCOME_HELP")).toBeVisible();
  });

  it("starts as not stating anything, and then sends no outcome", async () => {
    mocks.resolveAttention.mockResolvedValue(OK);
    setup("dismiss", WITH_OUTCOMES);
    expect(screen.getByTestId("governance-attention-outcome")).toHaveValue("");
    await typeOperator("ada");
    await typeNote("why");
    await userEvent.click(confirm());

    await waitFor(() => expect(mocks.resolveAttention).toHaveBeenCalled());
    expect(mocks.resolveAttention.mock.calls[0][1]).not.toHaveProperty(
      "outcome",
    );
  });

  it("sends the chosen outcome with the dismiss", async () => {
    mocks.resolveAttention.mockResolvedValue(OK);
    setup("dismiss", WITH_OUTCOMES);
    await choose("confirmed_not_executed");
    await typeOperator("ada");
    await typeNote("checked at central");
    await userEvent.click(confirm());

    await waitFor(() => expect(mocks.resolveAttention).toHaveBeenCalled());
    expect(mocks.resolveAttention).toHaveBeenCalledWith(ITEM.conversation_id, {
      action: "dismiss",
      expected_request_id: "req-1",
      operator: "ada",
      note: "checked at central",
      outcome: "confirmed_not_executed",
    });
  });

  it("shows central refusing the statement as a central problem, and stays open", async () => {
    mocks.resolveAttention.mockRejectedValue(
      await refusal(424, "central_failed"),
    );
    setup("dismiss", WITH_OUTCOMES);
    await choose("confirmed_executed");
    await typeOperator("ada");
    await typeNote("why");
    await userEvent.click(confirm());

    expect(
      await screen.findByTestId("governance-attention-error"),
    ).toHaveAttribute("data-kind", "central");
    expect(confirm()).toBeEnabled();
  });
});
