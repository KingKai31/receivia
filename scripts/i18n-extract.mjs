// Prints every literal key passed to t() under src (excluding tests), one per line, JSON array.
import ts from 'typescript';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const files = execSync('git ls-files src', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && /.tsx?$/.test(f) && !/\.test\./.test(f));
const keys = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(
    f,
    src,
    ts.ScriptTarget.Latest,
    true,
    f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  (function v(n) {
    if (
      ts.isCallExpression(n) &&
      /^(t|i18n\.t|tr)$/.test(n.expression.getText(sf)) &&
      n.arguments[0] &&
      (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))
    )
      keys.add(n.arguments[0].text);
    ts.forEachChild(n, v);
  })(sf);
}
const arr = [...keys].filter((k) => /[A-Za-z]{2}/.test(k)).sort();
fs.writeFileSync(process.argv[2] ?? 'keys.json', JSON.stringify(arr, null, 1));
console.log(arr.length);
