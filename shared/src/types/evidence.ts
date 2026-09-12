export interface FeatureCandidate {
  title: string;
  path: string;
  line: number;
  provenance: "static-export";
  verification: "unverified";
}
export interface FeatureEvidence {
  implementation:
    "unmapped" | "source-present" | "source-partial" | "source-unavailable";
  connection:
    "unknown" | "incoming-imports-found" | "no-incoming-imports-observed";
  proof: "not-established";
  presentPaths: string[];
  missingPaths: string[];
  references: Array<{
    path: string;
    line: number;
    kind: "scope" | "incoming-import";
  }>;
  limitations: string[];
  prompt: string;
}
