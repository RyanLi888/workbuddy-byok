import type { NetworkResponse, PluginContext } from "workbuddy-byok:plugin";
import type { ResourceSnapshot } from "workbuddy-byok:resource";
import { accountData, refreshAccount } from "./resources.ts";
import { codexModels } from "./models.ts";
import { CLIENT_ID, OAUTH_TOKEN_URL } from "./tokens.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function response(status: number, body: unknown): NetworkResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}

function token(exp: number): string {
  return `header.${btoa(JSON.stringify({ exp }))}.signature`;
}

function account(
  accessToken = "old-access",
  refreshToken: string | null = "old-refresh",
): ResourceSnapshot {
  return {
    id: "test",
    type: "chatgpt-account",
    key: "test",
    state: { status: "ready" },
    privateData: { accessToken, refreshToken, accountId: "account-id", displayName: "Person" },
  };
}

function context(fetch: PluginContext["network"]["fetch"]): PluginContext {
  return {
    network: {
      fetch,
      stream: () => {
        throw new Error("unexpected stream");
      },
    },
    signal: new AbortController().signal,
  };
}

Deno.test("Codex sync renews expired JWTs and uses persisted rotated credentials", async () => {
  const resource = account(token(1));
  const urls: string[] = [];
  const network = context((url, init) => {
    urls.push(url);
    if (url === OAUTH_TOKEN_URL) {
      const body = JSON.parse(init?.body ?? "{}");
      assert(body.client_id === CLIENT_ID && body.grant_type === "refresh_token");
      assert(body.refresh_token === "old-refresh");
      assert(init?.headers?.["content-type"] === "application/json");
      return Promise.resolve(
        response(200, { access_token: "new-access", refresh_token: "rotated" }),
      );
    }
    assert(init?.headers?.authorization === "Bearer new-access");
    assert(init?.headers?.["ChatGPT-Account-Id"] === "account-id");
    return Promise.resolve(
      url.includes("/codex/models")
        ? response(200, { models: [{ slug: "account-model" }] })
        : response(200, { plan_type: "plus" }),
    );
  });
  const patch = await refreshAccount(resource, network);
  assert(patch.privateData);
  const saved = { ...resource, privateData: patch.privateData };
  assert(accountData(saved).refreshToken === "rotated");
  const models = await codexModels.list({ resource: saved }, network);
  assert(models[0].id === "account-model");
  assert(urls.length === 3 && urls[0] === OAUTH_TOKEN_URL);
});

Deno.test("Codex refresh retries a usage 401 once and retains a non-rotated refresh token", async () => {
  let calls = 0;
  const patch = await refreshAccount(
    account(),
    context((url, init) => {
      calls++;
      if (calls === 1) return Promise.resolve(response(401, {}));
      if (calls === 2) {
        assert(url === OAUTH_TOKEN_URL);
        return Promise.resolve(response(200, { access_token: "new-access" }));
      }
      assert(init?.headers?.authorization === "Bearer new-access");
      return Promise.resolve(response(200, {}));
    }),
  );
  assert(calls === 3 && patch.state?.status === "ready" && patch.privateData);
  assert(
    accountData({ ...account(), privateData: patch.privateData }).refreshToken === "old-refresh",
  );
});

Deno.test("Codex valid credentials only refresh quota", async () => {
  let calls = 0;
  const patch = await refreshAccount(
    account(token(Date.now() / 1000 + 3600)),
    context((url) => {
      calls++;
      assert(url !== OAUTH_TOKEN_URL);
      return Promise.resolve(response(200, {}));
    }),
  );
  assert(calls === 1 && patch.state?.status === "ready");
});

Deno.test("Codex missing or rejected refresh credentials require sign-in without a retry loop", async () => {
  for (const refreshToken of [null, "revoked"]) {
    let calls = 0;
    const patch = await refreshAccount(
      account(token(1), refreshToken),
      context((url) => {
        calls++;
        assert(url === OAUTH_TOKEN_URL);
        return Promise.resolve(response(400, { error: "invalid_grant" }));
      }),
    );
    assert(patch.state?.status === "invalid");
    assert(calls === (refreshToken ? 1 : 0));
  }
});

Deno.test("Codex transient token errors are reported without marking the account invalid or exposing secrets", async () => {
  try {
    await refreshAccount(
      account(token(1)),
      context(() => Promise.resolve(response(503, { private: "old-refresh" }))),
    );
    throw new Error("expected rejection");
  } catch (error) {
    assert(String(error).includes("HTTP 503") && !String(error).includes("old-refresh"));
  }
});

Deno.test("Codex rotated credentials survive failed quota lookup", async () => {
  for (const failure of ["http", "network", "json", "unauthorized"]) {
    let calls = 0;
    const patch = await refreshAccount(
      account(token(1)),
      context(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve(
            response(200, { access_token: "new-access", refresh_token: "rotated" }),
          );
        }
        if (failure === "network") throw new Error("quota offline");
        if (failure === "json") return Promise.resolve({ status: 200, headers: {}, body: "{" });
        return Promise.resolve(response(failure === "unauthorized" ? 401 : 503, {}));
      }),
    );
    assert(calls === 2 && patch.privateData);
    assert(
      accountData({ ...account(), privateData: patch.privateData }).refreshToken === "rotated",
    );
    assert(patch.state?.status === (failure === "unauthorized" ? "invalid" : "ready"));
  }
});
