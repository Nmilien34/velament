import { Router, raw } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Job } from "../models/Job.js";
import { HttpError } from "../utils/errors.js";
export function validSignature(
  body: Buffer,
  signature: string,
  secret: string,
) {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export const webhooks = Router();
webhooks.post(
  "/github",
  raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret)
      throw new HttpError(
        503,
        "WEBHOOK_NOT_CONFIGURED",
        "Webhook secret is required",
      );
    if (
      !Buffer.isBuffer(req.body) ||
      !validSignature(req.body, req.get("x-hub-signature-256") || "", secret)
    )
      throw new HttpError(
        401,
        "INVALID_SIGNATURE",
        "Invalid webhook signature",
      );
    const id = z.string().uuid().parse(req.get("x-github-delivery"));
    const event = z.string().max(100).parse(req.get("x-github-event"));
    if (
      ![
        "push",
        "installation",
        "installation_repositories",
        "github_app_authorization",
        "workflow_run",
      ].includes(event)
    ) {
      res.sendStatus(204);
      return;
    }
    const body: unknown = JSON.parse(req.body.toString("utf8"));
    try {
      await Job.create({
        key: "webhook:" + id,
        kind: "webhook",
        payload: { event, body },
      });
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === 11000
      ))
        throw error;
    }
    res.status(202).json({ received: true });
  },
);
