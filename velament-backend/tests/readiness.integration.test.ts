import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { checkReadiness } from "../src/services/readiness.service.js";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("database readiness", () => {
  beforeAll(async () => {
    await mongoose.connect(uri!, {
      dbName: "velament_ready_" + randomBytes(8).toString("hex"),
    });
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
  it("accepts a real MongoDB ping", async () => {
    expect((await checkReadiness()).status).toBe("ready");
  });
});
