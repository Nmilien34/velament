import { beforeEach, afterEach, expect, it, vi } from "vitest";
const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));
import { exchangeIdentity } from "../src/services/identity-provider.service.js";
beforeEach(() => {
  vi.stubEnv("AUTH_API_ORIGIN", "http://localhost:4000");
  vi.stubEnv("AUTH_APP_ORIGIN", "http://localhost:5173");
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id_token: "signed-token" })),
      ),
  );
  verifyIdToken.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("validates Google tokens against the configured client and expected nonce", async () => {
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({
      sub: "google-1",
      email: "dev@example.com",
      email_verified: true,
      nonce: "expected",
      name: "Dev",
    }),
  });
  await expect(
    exchangeIdentity("google", "code", "verifier", "expected"),
  ).resolves.toMatchObject({ subject: "google-1", provider: "google" });
  expect(verifyIdToken).toHaveBeenCalledWith({
    idToken: "signed-token",
    audience: "google-client",
  });
});
it("rejects a token issued for another login attempt", async () => {
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({
      sub: "google-1",
      email: "dev@example.com",
      email_verified: true,
      nonce: "other",
    }),
  });
  await expect(
    exchangeIdentity("google", "code", "verifier", "expected"),
  ).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
});
it("rejects unverified provider email", async () => {
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({
      sub: "google-1",
      email: "dev@example.com",
      email_verified: false,
      nonce: "expected",
    }),
  });
  await expect(
    exchangeIdentity("google", "code", "verifier", "expected"),
  ).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
});
it("does not accept an invalid signature or audience", async () => {
  verifyIdToken.mockRejectedValue(new Error("Invalid signature"));
  await expect(
    exchangeIdentity("google", "code", "verifier", "expected"),
  ).rejects.toMatchObject({ status: 401 });
});
