import type { ClientSession } from "mongoose";
import { Pin } from "../models/Pin.js";
import { Feature } from "../models/Feature.js";
import { Revision } from "../models/Revision.js";
import { Activity } from "../models/Activity.js";
export function comparePinnedSource(
  pin: {
    paths: string[];
    hashes: { path: string; hash: string }[];
    edgeKeys: string[];
    featureVersion: number;
  },
  files: { path: string; hash: string }[],
  edges: { from: string; to: string }[],
  version: number,
) {
  if (version !== pin.featureVersion) return "scope-changed";
  if (
    !pin.paths.length ||
    pin.paths.some(
      (p) =>
        !files.some((f) => f.path === p) ||
        !pin.hashes.some((h) => h.path === p),
    )
  )
    return "unknown";
  const keys = edges
    .filter((e) => pin.paths.includes(e.from) || pin.paths.includes(e.to))
    .map((e) => e.from + " → " + e.to);
  return pin.paths.some(
    (p) =>
      files.find((f) => f.path === p)!.hash !==
      pin.hashes.find((h) => h.path === p)!.hash,
  ) ||
    keys.some((k) => !pin.edgeKeys.includes(k)) ||
    pin.edgeKeys.some((k) => !keys.includes(k))
    ? "changed"
    : "unchanged";
}
export async function protectPins(
  projectId: string,
  snapshot: {
    id: string;
    branch: string;
    files: { path: string; hash: string }[];
    edges: { from: string; to: string }[];
  },
  session: ClientSession,
) {
  const pins = await Pin.find({ projectId }).session(session);
  for (const pin of pins) {
    const feature = await Feature.findOne({
      _id: pin.featureId,
      projectId,
      archivedAt: null,
    }).session(session);
    const baseline = await Revision.findOne({ _id: pin.revisionId, projectId })
      .select("branch")
      .session(session);
    if (
      !feature ||
      !baseline ||
      baseline.branch !== snapshot.branch ||
      pin.revisionId.toString() === snapshot.id
    )
      continue;
    const status = comparePinnedSource(
      pin,
      snapshot.files,
      snapshot.edges,
      feature.version,
    );
    await Activity.updateOne(
      { eventKey: `pin:${pin.id}:${pin.updatedAt.getTime()}:${snapshot.id}` },
      {
        $setOnInsert: {
          projectId,
          kind: "pin-comparison",
          referenceId: feature.id,
          message: `Pinned feature “${feature.title}”: ${status} source compared with its baseline. Revision ${snapshot.id}. Environment ${pin.environment}. Runtime behavior remains unverified.`,
        },
      },
      { upsert: true, session },
    );
  }
}
