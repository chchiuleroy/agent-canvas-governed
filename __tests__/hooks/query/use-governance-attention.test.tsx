import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeConversationId,
  useGovernanceAttention,
  useGovernanceAttentionTitles,
} from "#/hooks/query/use-governance-attention";

const backendMock = vi.hoisted(() => ({
  current: {
    backend: {
      id: "local-1",
      kind: "local" as "local" | "cloud",
      connectionRevision: 0 as number | undefined,
    },
    orgId: null as string | null,
  },
}));
vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => backendMock.current,
}));

const statusMock = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("#/hooks/query/use-governance-status", () => ({
  useGovernanceStatus: () => ({ data: statusMock.data }),
}));

const batchGet = vi.hoisted(() => vi.fn());
vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({
    default: {
      batchGetAppConversations: (...args: unknown[]) => batchGet(...args),
    },
  }),
);

const getAttention = vi.hoisted(() => vi.fn());
vi.mock("#/api/governance-service/governance-service.api", () => ({
  default: { getAttention: (...args: unknown[]) => getAttention(...args) },
}));

const team = {
  deployment_mode: "team",
  missing_settings: [],
  central_api: null,
};

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  backendMock.current = {
    backend: { id: "local-1", kind: "local", connectionRevision: 0 },
    orgId: null,
  };
  statusMock.data = team;
  getAttention.mockResolvedValue([]);
});

describe("useGovernanceAttention", () => {
  it("asks the local agent-server in team mode", async () => {
    getAttention.mockResolvedValue([{ conversation_id: "c1" }]);
    const { result } = renderHook(() => useGovernanceAttention(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(result.current.data).toEqual([{ conversation_id: "c1" }]),
    );
  });

  it.each([
    ["while the mode is not known yet", undefined],
    ["when the status could not be read", null],
    [
      "in personal mode",
      { deployment_mode: "personal", missing_settings: [], central_api: null },
    ],
  ])("does not ask %s", async (_label, status) => {
    // there is no outbox outside team mode, so asking would only be noise
    statusMock.data = status;
    renderHook(() => useGovernanceAttention(), { wrapper: makeWrapper() });

    await Promise.resolve();
    expect(getAttention).not.toHaveBeenCalled();
  });

  it("does not ask on a cloud backend", async () => {
    backendMock.current = {
      backend: { id: "cloud-1", kind: "cloud", connectionRevision: 0 },
      orgId: null,
    };
    renderHook(() => useGovernanceAttention(), { wrapper: makeWrapper() });

    await Promise.resolve();
    expect(getAttention).not.toHaveBeenCalled();
  });

  it("asks again when the backend's connection details change", async () => {
    const wrapper = makeWrapper();
    const { rerender } = renderHook(() => useGovernanceAttention(), {
      wrapper,
    });
    await waitFor(() => expect(getAttention).toHaveBeenCalledTimes(1));

    backendMock.current = {
      backend: { id: "local-1", kind: "local", connectionRevision: 1 },
      orgId: null,
    };
    rerender();

    await waitFor(() => expect(getAttention).toHaveBeenCalledTimes(2));
  });
});

describe("useGovernanceAttentionTitles", () => {
  it("asks once, for each id once and in a fixed order, and keys the answer by a normalised id", async () => {
    batchGet.mockResolvedValue([
      { id: "BBBBBBBB-0000-0000-0000-000000000000", title: "Second" },
      null,
      { id: "aaaaaaaa000000000000000000000000", title: null },
    ]);
    const { result } = renderHook(
      () =>
        useGovernanceAttentionTitles([
          "bbbbbbbb-0000-0000-0000-000000000000",
          "aaaaaaaa-0000-0000-0000-000000000000",
          "bbbbbbbb-0000-0000-0000-000000000000",
        ]),
      { wrapper: makeWrapper() },
    );

    await waitFor(() =>
      expect(result.current.data).toEqual({
        bbbbbbbb000000000000000000000000: "Second",
        aaaaaaaa000000000000000000000000: null,
      }),
    );
    expect(batchGet).toHaveBeenCalledTimes(1);
    expect(batchGet).toHaveBeenCalledWith([
      "aaaaaaaa-0000-0000-0000-000000000000",
      "bbbbbbbb-0000-0000-0000-000000000000",
    ]);
  });

  it("does not ask when there is nothing to look up or on a cloud backend", async () => {
    renderHook(() => useGovernanceAttentionTitles([]), {
      wrapper: makeWrapper(),
    });
    backendMock.current = {
      backend: { id: "cloud-1", kind: "cloud", connectionRevision: 0 },
      orgId: null,
    };
    renderHook(() => useGovernanceAttentionTitles(["a"]), {
      wrapper: makeWrapper(),
    });

    await Promise.resolve();
    expect(batchGet).not.toHaveBeenCalled();
  });

  it("leaves the titles unknown when the lookup fails", async () => {
    batchGet.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useGovernanceAttentionTitles(["a"]), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("normalizeConversationId", () => {
  it("makes the spellings of one id equal", () => {
    expect(
      normalizeConversationId("AAAAAAAA-0000-0000-0000-000000000000"),
    ).toBe(normalizeConversationId("aaaaaaaa000000000000000000000000"));
  });
});
