import { beforeEach, describe, expect, it, vi } from "vitest";
import GovernanceService from "#/api/governance-service/governance-service.api";

const mocks = vi.hoisted(() => ({
  kind: "local" as "local" | "cloud",
  get: vi.fn(),
  close: vi.fn(),
  ctorOptions: vi.fn(),
}));

vi.mock("@openhands/typescript-client/clients", () => ({
  AgentServerClient: class {
    constructor(options: unknown) {
      mocks.ctorOptions(options);
    }

    get = mocks.get;

    close = mocks.close;
  },
}));
vi.mock("#/api/backend-registry/active-store", () => ({
  getActiveBackend: () => ({ backend: { kind: mocks.kind } }),
}));
vi.mock("#/api/agent-server-client-options", () => ({
  getAgentServerClientOptions: () => ({
    host: "http://127.0.0.1:18000",
    apiKey: "session-key",
    workingDir: "/w",
  }),
}));

beforeEach(() => {
  mocks.kind = "local";
  mocks.get.mockReset();
  mocks.close.mockReset();
  mocks.ctorOptions.mockReset();
});

describe("GovernanceService.getStatus", () => {
  it("asks the local agent-server, authenticated like every other call", async () => {
    const body = {
      deployment_mode: "team",
      missing_settings: [],
      central_api: null,
    };
    mocks.get.mockResolvedValue(body);

    await expect(GovernanceService.getStatus()).resolves.toEqual(body);
    expect(mocks.ctorOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "http://127.0.0.1:18000",
        apiKey: "session-key",
      }),
    );
    expect(mocks.get).toHaveBeenCalledWith("/api/governance/status");
    expect(mocks.close).toHaveBeenCalled();
  });

  it("does not call anything on a cloud backend", async () => {
    mocks.kind = "cloud";
    await expect(GovernanceService.getStatus()).resolves.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("treats 404 (agent-server without the governance layer) as not applicable", async () => {
    mocks.get.mockRejectedValue(
      Object.assign(new Error("nf"), { status: 404 }),
    );
    await expect(GovernanceService.getStatus()).resolves.toBeNull();
    expect(mocks.close).toHaveBeenCalled();
  });

  it("rejects on other failures so unknown is not mistaken for personal", async () => {
    mocks.get.mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 }),
    );
    await expect(GovernanceService.getStatus()).rejects.toThrow("boom");
    expect(mocks.close).toHaveBeenCalled();
  });
});
