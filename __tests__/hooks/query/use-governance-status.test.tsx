import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGovernanceStatus } from "#/hooks/query/use-governance-status";

// The active backend is swapped per test through this mutable holder.
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

const getStatus = vi.hoisted(() => vi.fn());
vi.mock("#/api/governance-service/governance-service.api", () => ({
  default: { getStatus: (...args: unknown[]) => getStatus(...args) },
}));

const TEAM = {
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
  getStatus.mockResolvedValue(TEAM);
});

describe("useGovernanceStatus", () => {
  it("reports what the service returns for a local backend", async () => {
    const { result } = renderHook(() => useGovernanceStatus(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(TEAM));
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("does not ask at all on a cloud backend", async () => {
    backendMock.current = {
      backend: { id: "cloud-1", kind: "cloud", connectionRevision: 0 },
      orgId: null,
    };

    renderHook(() => useGovernanceStatus(), { wrapper: makeWrapper() });

    await Promise.resolve();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("asks again when the backend's connection details change", async () => {
    // Why: editing the active backend's host or API key bumps
    // connectionRevision but keeps the id. A query keyed on the id alone kept
    // showing the previous server's mode (and so its team-mode gating) until
    // the next poll.
    const wrapper = makeWrapper();
    const { rerender } = renderHook(() => useGovernanceStatus(), { wrapper });
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    backendMock.current = {
      backend: { id: "local-1", kind: "local", connectionRevision: 1 },
      orgId: null,
    };
    rerender();

    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2));
  });

  it("does not ask again when nothing about the connection changed", async () => {
    const wrapper = makeWrapper();
    const { rerender } = renderHook(() => useGovernanceStatus(), { wrapper });
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    rerender();
    await Promise.resolve();

    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("leaves data undefined when the request fails", async () => {
    // Callers treat anything but an affirmative "team" as unchanged behavior.
    getStatus.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useGovernanceStatus(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
