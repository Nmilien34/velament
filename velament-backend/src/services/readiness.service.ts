import mongoose from "mongoose";
import type { Connection } from "mongoose";
import type { ReadinessResponse } from "@velament/shared";
export async function checkReadiness(
  connection: Pick<Connection, "readyState" | "db"> = mongoose.connection,
): Promise<ReadinessResponse> {
  const unavailable: ReadinessResponse = {
    status: "not-ready",
    service: "velament-api",
  };
  if (connection.readyState !== 1 || !connection.db) return unavailable;
  try {
    const result = await connection.db.command(
      { ping: 1 },
      { timeoutMS: 1000 },
    );
    return result.ok === 1
      ? { status: "ready", service: "velament-api" }
      : unavailable;
  } catch {
    return unavailable;
  }
}
