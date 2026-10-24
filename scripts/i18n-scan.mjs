// Lists string literals that look like user-facing English and are not inside t().
import ts from 'typescript';
import fs from 'node:fs';
const out = [];
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  (function v(n) {
    if (ts.isImportDeclaration(n) || ts.isTypeNode(n) || ts.isLiteralTypeNode(n)) return;
    if (ts.isCallExpression(n) && /^(t|i18n\.t)$/.test(n.expression.getText(sf))) return;
    if (
      ts.isJsxAttribute(n) &&
      [
        'className',
        'type',
        'to',
        'href',
        'name',
        'id',
        'role',
        'key',
        'inputMode',
        'autoComplete',
        'rel',
        'target',
        'htmlFor',
        'value',
        'data-testid',
      ].includes(n.name.getText(sf))
    )
      return;
    let text = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
    else if (ts.isTemplateExpression(n))
      text = n.head.text + n.templateSpans.map((s) => '${}' + s.literal.text).join('');
    if (
      text &&
      /[A-Za-z]{3,}/.test(text) &&
      (/\s/.test(text) || /^[A-Z][a-z]+$/.test(text)) &&
      !/^[a-z_\-:./]+$/.test(text) &&
      !/^(use client|\w+\/\w+)/.test(text)
    ) {
      const p = n.parent;
      if (
        !(ts.isPropertyAssignment(p) && p.name === n) &&
        !ts.isElementAccessExpression(p) &&
        !(ts.isBinaryExpression(p) && ['===', '!==', '=='].includes(p.operatorToken.getText(sf))) &&
        !ts.isCaseClause(p)
      )
        out.push(
          `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${JSON.stringify(text).slice(0, 110)}`,
        );
    }
    ts.forEachChild(n, v);
  })(sf);
}
console.log(out.join('\n'));
