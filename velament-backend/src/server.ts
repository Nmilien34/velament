import { startWorker } from "./services/job.service.js";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
await mongoose.connect(env.MONGODB_URI);
await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
const stopWorker = startWorker();
const app = createApp(env.CLIENT_ORIGIN);
const server = app.listen(env.PORT, () =>
  console.log(`API listening on ${env.PORT}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    app.locals.draining = true;
    server.close(() => {
      void stopWorker()
        .then(() => mongoose.disconnect())
        .then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
