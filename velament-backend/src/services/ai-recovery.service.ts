import { AiDiscovery } from "../models/AiDiscovery.js";
import { HttpError } from "../utils/errors.js";
// Longer than the provider timeout. Never resend an uncertain paid request.
export async function getDiscovery(projectId: string, id: string) {
  const filter = { _id: id, projectId };
  await AiDiscovery.updateOne(
    {
      ...filter,
      status: "pending",
      $or: [
        { startedAt: { $lte: new Date(Date.now() - 120000) } },
        {
          startedAt: { $exists: false },
          createdAt: { $lte: new Date(Date.now() - 120000) },
        },
      ],
    },
    { $set: { status: "failed", errorCode: "AI_REQUEST_INTERRUPTED" } },
  );
  const record = await AiDiscovery.findOne(filter);
  if (!record) throw new HttpError(404, "NOT_FOUND", "AI discovery not found");
  return record;
}

export async function claimDiscoveryRetry(
  projectId: string,
  id: string,
  attempt: number,
) {
  return AiDiscovery.findOneAndUpdate(
    {
      _id: id,
      projectId,
      status: "failed",
      $or: [
        { attempt },
        ...(attempt === 1 ? [{ attempt: { $exists: false } }] : []),
      ],
    },
    {
      $set: { status: "pending", attempt: attempt + 1, startedAt: new Date() },
      $unset: { errorCode: 1, result: 1 },
    },
    { new: true },
  );
}
