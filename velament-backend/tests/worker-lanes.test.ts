import { beforeAll, afterAll, it, expect } from "vitest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { Job } from "../src/models/Job.js";
import { processNextJob } from "../src/services/job.service.js";
const uri = process.env.TEST_MONGODB_URI;
beforeAll(async () => {
  if (uri) await mongoose.connect(uri, { dbName: "lanes_" + randomUUID() });
});
afterAll(async () => {
  if (uri) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
it.skipIf(!uri)(
  "webhook lane processes events without claiming queued analysis",
  async () => {
    const analysis = await Job.create({
      kind: "analysis",
      key: "older",
      requestedBranch: "main",
    });
    const event = await Job.create({
      kind: "webhook",
      key: "event",
      payload: { event: "ping", body: { action: "test" } },
    });
    await processNextJob("webhook");
    expect((await Job.findById(analysis.id))?.status).toBe("queued");
    expect((await Job.findById(event.id))?.status).toBe("completed");
  },
);
