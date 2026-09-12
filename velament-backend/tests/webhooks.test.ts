import { it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { validSignature } from "../src/routes/webhooks.js";
it("validates exact webhook bytes and rejects tampering", () => {
  const body = Buffer.from('{"ok":true}'),
    secret = "test-secret",
    sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  expect(validSignature(body, sig, secret)).toBe(true);
  expect(validSignature(Buffer.from("{}"), sig, secret)).toBe(false);
  expect(validSignature(body, "sha256=bad", secret)).toBe(false);
});
