import { z } from "zod";
export const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const projectInput = z
  .object({
    installationId: z.number().int().positive(),
    repositoryId: z.number().int().positive(),
    owner: z.string().regex(/^[a-z\d-]{1,100}$/i),
    repo: z.string().regex(/^[a-z\d_.-]{1,100}$/i),
    branch: z.string().trim().min(1).max(200).default("main"),
  })
  .strict();
export const featureInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    requirement: z.string().trim().min(1).max(5000),
    kind: z.enum(["planned", "existing"]),
    paths: z.array(z.string().min(1).max(500)).max(200).default([]),
    revisionId: objectId,
  })
  .strict();
export const pinInput = z
  .object({
    revisionId: objectId,
    environment: z.enum(["test", "staging", "production"]).default("test"),
  })
  .strict();
export const errorInput = z
  .object({
    revisionId: objectId,
    text: z.string().trim().min(1).max(20000),
    manualPath: z.string().min(1).max(500).optional(),
  })
  .strict();
export type ProjectInput = z.infer<typeof projectInput>;
export type FeatureInput = z.infer<typeof featureInput>;
export interface GraphNode {
  path: string;
  hash: string;
  kind: "source";
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: "import";
  line: number;
}
export interface SourceFile {
  path: string;
  content: string;
  hash: string;
}
export interface TraceFrame {
  path: string;
  line: number | null;
  lineAvailable: boolean;
  provenance: "trace" | "manual";
}

export const investigationRecheckInput = z
  .object({
    revisionId: objectId,
    text: z.string().trim().min(1).max(20000).optional(),
    manualPath: z.string().min(1).max(500).nullable().optional(),
  })
  .strict();
export type InvestigationRecheckInput = z.infer<
  typeof investigationRecheckInput
>;
