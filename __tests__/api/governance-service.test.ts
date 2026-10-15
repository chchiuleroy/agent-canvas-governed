import { beforeEach, describe, expect, it, vi } from "vitest";
import GovernanceService, {
  GovernanceResolveError,
} from "#/api/governance-service/governance-service.api";

const mocks = vi.hoisted(() => ({
  kind: "local" as "local" | "cloud",
  get: vi.fn(),
  post: vi.fn(),
  close: vi.fn(),
  ctorOptions: vi.fn(),
}));

vi.mock("@openhands/typescript-client/clients", () => ({
  AgentServerClient: class {
    constructor(options: unknown) {
      mocks.ctorOptions(options);
    }

    get = mocks.get;

    post = mocks.post;

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
  mocks.post.mockReset();
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

describe("GovernanceService attention", () => {
  const item = {
    conversation_id: "c1",
    reason: "claim_failed",
    last_error_code: null,
    central_approval_id: null,
    request_id: "r1",
    attempt_count: 1,
    last_attempt_at: null,
    allowed_actions: ["retry", "dismiss"],
  };

  it("lists the parked conversations from the local agent-server", async () => {
    mocks.get.mockResolvedValue([item]);
    await expect(GovernanceService.getAttention()).resolves.toEqual([item]);
    expect(mocks.get).toHaveBeenCalledWith("/api/governance/attention");
    expect(mocks.close).toHaveBeenCalled();
  });

  it("has nothing to report on a cloud backend or an agent-server without the endpoint", async () => {
    mocks.kind = "cloud";
    await expect(GovernanceService.getAttention()).resolves.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();

    mocks.kind = "local";
    mocks.get.mockRejectedValue(
      Object.assign(new Error("nf"), { status: 404 }),
    );
    await expect(GovernanceService.getAttention()).resolves.toBeNull();
  });

  it("rejects on other failures so unknown is not mistaken for empty", async () => {
    mocks.get.mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 }),
    );
    await expect(GovernanceService.getAttention()).rejects.toThrow("boom");
  });

  it("posts exactly the request it is given, to the right conversation", async () => {
    const result = { conversation_id: "c 1/x", new_state: "resolved_manually" };
    mocks.post.mockResolvedValue(result);
    const body = {
      action: "dismiss" as const,
      expected_request_id: "r1",
      operator: "ada",
      note: "why",
    };
    await expect(
      GovernanceService.resolveAttention("c 1/x", body),
    ).resolves.toEqual(result);
    // the id is encoded: it must not be able to change the path
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/governance/attention/c%201%2Fx/resolve",
      body,
    );
    expect(mocks.close).toHaveBeenCalled();
  });

  it("reduces a refusal to its status and the server's error_code", async () => {
    mocks.post.mockRejectedValue(
      Object.assign(new Error("HTTP 409"), {
        status: 409,
        response: {
          detail: { error_code: "request_id_mismatch", detail: "free text" },
        },
      }),
    );
    const error = await GovernanceService.resolveAttention("c1", {
      action: "retry",
      expected_request_id: "r1",
      operator: "ada",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GovernanceResolveError);
    expect((error as GovernanceResolveError).status).toBe(409);
    expect((error as GovernanceResolveError).errorCode).toBe(
      "request_id_mismatch",
    );
    // the server's free text (which can quote operator input) is not carried
    expect((error as Error).message).not.toContain("free text");
    expect(mocks.close).toHaveBeenCalled();
  });

  it("copes with a failure that carries no status or body", async () => {
    mocks.post.mockRejectedValue(new Error("network down"));
    const error = await GovernanceService.resolveAttention("c1", {
      action: "retry",
      expected_request_id: "r1",
      operator: "ada",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GovernanceResolveError);
    expect((error as GovernanceResolveError).status).toBeNull();
    expect((error as GovernanceResolveError).errorCode).toBeNull();
  });
});
