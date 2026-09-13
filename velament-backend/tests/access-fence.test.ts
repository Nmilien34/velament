import { beforeAll, afterAll, it, expect } from "vitest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import {
  accessGeneration,
  assertAccess,
  revokeAccess,
} from "../src/services/access.service.js";
import { Project } from "../src/models/Project.js";
const uri = process.env.TEST_MONGODB_URI;
beforeAll(async () => {
  if (uri) await mongoose.connect(uri, { dbName: "fence_" + randomUUID() });
});
afterAll(async () => {
  if (uri) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
it.skipIf(!uri)(
  "revocation rejects an old generation even after project reconnection",
  async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const p = await Project.create({
      userId,
      owner: "a",
      repo: "b",
      branch: "main",
    });
    const generation = await accessGeneration(userId);
    await revokeAccess(userId);
    await Project.updateOne(
      { _id: p.id },
      { $set: { connectionState: "active" } },
    );
    await expect(
      mongoose.connection.transaction((s) =>
        assertAccess(userId, generation, s),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_REVOKED" });
  },
);
