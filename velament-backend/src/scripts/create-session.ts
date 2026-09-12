import { randomBytes, createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
if (env.NODE_ENV === "production")
  throw new Error("Local provisioning is disabled in production");
const email = z.email().parse(process.argv[2]);
await mongoose.connect(env.MONGODB_URI);
try {
  const user = await User.findOneAndUpdate(
    { email },
    { $setOnInsert: { email, name: email.split("@")[0] } },
    { upsert: true, new: true },
  );
  const token = randomBytes(32).toString("base64url");
  await Session.create({
    userId: user.id,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 86400000),
  });
  console.log("Development bearer token (expires in 24 hours): " + token);
} finally {
  await mongoose.disconnect();
}
