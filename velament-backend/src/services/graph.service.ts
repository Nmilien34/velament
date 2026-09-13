import ts from "typescript";
import path from "node:path";
import type { SourceFile, GraphEdge, TraceFrame } from "@velament/shared";
export function buildEdges(files: SourceFile[]): GraphEdge[] {
  const known = new Set(files.map((f) => f.path)),
    edges: GraphEdge[] = [];
  for (const file of files) {
    const ast = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      let spec: string | undefined;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        spec = node.moduleSpecifier.text;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require")) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        spec = node.arguments[0].text;
      if (spec?.startsWith(".")) {
        const base = path.posix.normalize(
          path.posix.join(path.posix.dirname(file.path), spec),
        );
        const stem = base.replace(/\.[cm]?jsx?$/, "");
        const target = [
          base,
          ...(base.endsWith(".mjs") ? [base.slice(0, -4) + ".mts"] : []),
          ...(base.endsWith(".cjs") ? [base.slice(0, -4) + ".cts"] : []),
          ...[
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".mts",
            ".cts",
            ".mjs",
            ".cjs",
            "/index.ts",
            "/index.tsx",
            "/index.js",
            "/index.jsx",
          ].map((ext) => stem + ext),
        ].find((p) => known.has(p));
        if (target)
          edges.push({
            from: file.path,
            to: target,
            kind: "import",
            line:
              ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return edges;
}
export function locateTrace(
  text: string,
  files: SourceFile[],
  manualPath?: string,
): TraceFrame[] {
  if (manualPath)
    return files.some((f) => f.path === manualPath)
      ? [
          {
            path: manualPath,
            line: null,
            lineAvailable: false,
            provenance: "manual",
          },
        ]
      : [];
  const frames: TraceFrame[] = [];
  for (const row of text.replaceAll("\\", "/").split("\n"))
    for (const f of files) {
      const escaped = f.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = row.match(
        new RegExp(
          "(?:^|[\\s(/])" + escaped + "(?::(\\d+))?(?::\\d+)?(?=$|[\\s)])",
        ),
      );
      if (!match) continue;
      const line = match[1] ? Number(match[1]) : null;
      frames.push({
        path: f.path,
        line,
        lineAvailable:
          line !== null && line > 0 && line <= f.content.split("\n").length,
        provenance: "trace",
      });
    }
  return frames;
}
