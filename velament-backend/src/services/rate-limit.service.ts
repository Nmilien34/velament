import { createHash } from "node:crypto";
import { RequestBudget } from "../models/RequestBudget.js";
export async function consumeBudget(
  scope: string,
  client: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now(),
    window = Math.floor(now / windowMs),
    end = (window + 1) * windowMs;
  const _id = createHash("sha256")
    .update(JSON.stringify([scope, client, window]))
    .digest("hex");
  const update = {
    $inc: { count: 1 },
    $setOnInsert: { expiresAt: new Date(end) },
  };
  let record;
  try {
    record = await RequestBudget.findOneAndUpdate({ _id }, update, {
      upsert: true,
      new: true,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    record = await RequestBudget.findOneAndUpdate(
      { _id },
      { $inc: { count: 1 } },
      { new: true },
    );
  }
  return {
    allowed: !!record && record.count <= limit,
    retryAfter: Math.max(1, Math.ceil((end - now) / 1000)),
  };
}
