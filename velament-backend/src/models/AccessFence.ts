import { Schema, model } from "mongoose";
export const AccessFence = model(
  "AccessFence",
  new Schema({
    _id: { type: Schema.Types.ObjectId, required: true },
    generation: { type: Number, default: 0 },
    writes: { type: Number, default: 0 },
  }),
);
