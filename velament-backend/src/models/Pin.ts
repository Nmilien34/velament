import { Schema, model } from "mongoose";
export const Pin = model(
  "Pin",
  new Schema(
    {
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      featureId: { type: Schema.Types.ObjectId, required: true, unique: true },
      revisionId: { type: Schema.Types.ObjectId, required: true },
      featureVersion: { type: Number, required: true },
      environment: { type: String, required: true },
      paths: [String],
      hashes: [
        {
          _id: false,
          path: { type: String, required: true },
          hash: { type: String, required: true },
        },
      ],
      edgeKeys: [String],
    },
    { timestamps: true },
  ),
);
