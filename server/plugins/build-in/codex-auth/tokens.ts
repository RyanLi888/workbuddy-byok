import type { PluginContext } from "workbuddy-byok:plugin";

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";

/** null means the refresh credential was rejected and the account needs a new sign-in. */
export async function refreshAccessToken(
  refreshToken: string,
  context: PluginContext,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const response = await context.network.fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if ([400, 401, 403].includes(response.status)) return null;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Codex token refresh failed (HTTP ${response.status}); try again later`);
  }
  let body: { access_token?: unknown; refresh_token?: unknown };
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new Error("Codex token refresh returned invalid JSON");
  }
  if (typeof body?.access_token !== "string" || !body.access_token.trim()) {
    throw new Error("Codex token refresh returned no access token");
  }
  return {
    accessToken: body.access_token.trim(),
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token.trim()
      ? body.refresh_token.trim()
      : refreshToken,
  };
}
