import { expect, it } from "vitest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { Pin } from "../src/models/Pin.js";
import { Feature } from "../src/models/Feature.js";
import { Revision } from "../src/models/Revision.js";
import { Activity } from "../src/models/Activity.js";
import { protectPins } from "../src/services/pin-protection.service.js";
import { comparePinnedSource } from "../src/services/pin-protection.service.js";
const pin = {
  paths: ["a.ts"],
  hashes: [{ path: "a.ts", hash: "old" }],
  edgeKeys: [],
  featureVersion: 1,
};
it.skipIf(!process.env.TEST_MONGODB_URI)(
  "deduplicates comparisons and skips other branches",
  async () => {
    await mongoose.connect(process.env.TEST_MONGODB_URI!, {
      dbName: "pins_" + randomUUID(),
    });
    try {
      await Promise.all([
        Pin.init(),
        Feature.init(),
        Revision.init(),
        Activity.init(),
      ]);
      const projectId = new mongoose.Types.ObjectId().toString();
      const baseline = await Revision.create({
        projectId,
        sha: "a",
        branch: "main",
        state: "partial",
      });
      const feature = await Feature.create({
        projectId,
        title: "Signup",
        revisionId: baseline.id,
        requirement: "Signup",
        kind: "existing",
        paths: ["a.ts"],
      });
      await Pin.create({
        ...pin,
        projectId,
        featureId: feature.id,
        revisionId: baseline.id,
        environment: "test",
      });
      const snapshot = {
        id: new mongoose.Types.ObjectId().toString(),
        branch: "main",
        files: [{ path: "a.ts", hash: "new" }],
        edges: [],
      };
      await mongoose.connection.transaction((s) =>
        protectPins(projectId, snapshot, s),
      );
      await mongoose.connection.transaction((s) =>
        protectPins(projectId, snapshot, s),
      );
      await mongoose.connection.transaction((s) =>
        protectPins(
          projectId,
          {
            ...snapshot,
            id: new mongoose.Types.ObjectId().toString(),
            branch: "other",
          },
          s,
        ),
      );
      expect(await Activity.countDocuments()).toBe(1);
      expect((await Activity.findOne())?.message).toContain("changed source");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
it("distinguishes changed, unchanged, and unavailable source", () => {
  expect(comparePinnedSource(pin, [{ path: "a.ts", hash: "new" }], [], 1)).toBe(
    "changed",
  );
  expect(comparePinnedSource(pin, [{ path: "a.ts", hash: "old" }], [], 1)).toBe(
    "unchanged",
  );
  expect(comparePinnedSource(pin, [], [], 1)).toBe("unknown");
  expect(comparePinnedSource(pin, [{ path: "a.ts", hash: "old" }], [], 2)).toBe(
    "scope-changed",
  );
  expect(comparePinnedSource({ ...pin, paths: [] }, [], [], 1)).toBe("unknown");
});
