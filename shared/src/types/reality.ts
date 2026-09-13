export interface RealityFinding {
  id: string;
  path: string;
  line: number;
  kind: "dynamic" | "hardcoded" | "mocked" | "placeholder";
  description: string;
  provenance: "static-pattern";
}
export interface RealityEvidence {
  findings: RealityFinding[];
  truncated: boolean;
  verification: "not-established";
  limitations: string[];
}
