import ts from "typescript";
import { createHash } from "node:crypto";
import type {
  SourceFile,
  RealityEvidence,
  RealityFinding,
} from "@velament/shared";

export function inspectReality(files: SourceFile[]): RealityEvidence {
  const findings: RealityFinding[] = [];
  let truncated = false;
  for (const file of files) {
    const ast = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
    );
    const add = (
      node: ts.Node,
      kind: RealityFinding["kind"],
      description: string,
    ) => {
      if (findings.length >= 500) {
        truncated = true;
        return;
      }
      const start = node.getStart(ast);
      findings.push({
        id: createHash("sha256")
          .update(JSON.stringify([file.path, file.hash, start, kind]))
          .digest("hex"),
        path: file.path,
        line: ast.getLineAndCharacterOfPosition(start).line + 1,
        kind,
        description,
        provenance: "static-pattern",
      });
    };
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        (ts.isStringLiteral(node.initializer) ||
          ts.isNumericLiteral(node.initializer) ||
          [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(
            node.initializer.kind,
          ))
      )
        add(
          node,
          "hardcoded",
          "Variable initialized with a literal. This may be intentional policy or initial state; inspect its uses.",
        );
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(ast);
        if (
          ["fetch", "request.json", "req.json", "request.formData"].includes(
            name,
          )
        )
          add(
            node,
            "dynamic",
            "Call suggests external or request input. Symbol identity, execution and provider connectivity are unverified.",
          );
        if (/^(vi|jest)\.(mock|fn|spyOn)$/.test(name))
          add(
            node,
            "mocked",
            "Test-double call detected. This does not establish that production behavior is mocked.",
          );
      }
      if (
        ts.isThrowStatement(node) &&
        ts.isNewExpression(node.expression) &&
        node.expression.expression.getText(ast) === "Error" &&
        node.expression.arguments?.some(
          (a) => ts.isStringLiteral(a) && /not implemented|todo/i.test(a.text),
        )
      )
        add(
          node,
          "placeholder",
          "Explicit not-implemented error. Reachability and intended behavior require investigation.",
        );
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return {
    findings,
    truncated,
    verification: "not-established",
    limitations: [
      "Heuristic source patterns apply to individual expressions, not entire files or features.",
      "No finding means unknown, not verified real. Aliases, custom mocks, data flow and runtime behavior are not resolved.",
      "At most 500 findings are returned. Literal values are omitted; inspect source through the authorized source endpoint.",
    ],
  };
}
