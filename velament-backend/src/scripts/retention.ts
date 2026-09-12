import { config } from "dotenv";
import mongoose from "mongoose";
import { Job } from "../models/Job.js";
config({ path: ".env", quiet: true });
if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI");
await mongoose.connect(process.env.MONGODB_URI);
try {
  const filter = {
    kind: "analysis",
    status: { $in: ["completed", "cancelled"] },
    updatedAt: { $lt: new Date(Date.now() - 90 * 86400000) },
  };
  const count = await Job.countDocuments(filter);
  if (process.argv.includes("--apply")) {
    await Job.deleteMany(filter);
    console.log(JSON.stringify({ removedAnalysisJobs: count }));
  } else
    console.log(JSON.stringify({ eligibleAnalysisJobs: count, dryRun: true }));
} finally {
  await mongoose.disconnect();
}
