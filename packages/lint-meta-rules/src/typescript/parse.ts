import ts from 'typescript';

/**
 * Reading JS and TS through the TypeScript parser, for the rules on the
 * `/typescript` entry point.
 *
 * A hand-written scanner cannot find comments reliably: it cannot tell the `}`
 * that closes a template substitution from any other `}`, a regex literal from
 * a division, or JSX text from code, because each needs the parser's context.
 * One wrong guess and the rest of the file reads as a string.
 */

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/u.test(file)) return ts.ScriptKind.JS;
  if (file.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

/** Parse `source` as the file type its name says. */
export function parseSource(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
}

/** One comment: its full text (opener included) and its 1-based line. */
export interface SourceComment {
  readonly text: string;
  readonly line: number;
}

/**
 * Every comment in `source`, each exactly once.
 *
 * The parser's leaf tokens cover the file and a comment can only sit in the
 * trivia between one leaf and the next, so walking the leaves visits every
 * comment. JSX text is the one leaf with no trivia of its own: `//` there is
 * text, not a comment.
 */
export function sourceComments(file: string, source: string): SourceComment[] {
  const sourceFile = parseSource(file, source);
  const seen = new Map<number, SourceComment>();
  const collect = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.set(range.pos, {
        text: source.slice(range.pos, range.end),
        line: sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1,
      });
    }
  };
  const visit = (node: ts.Node): void => {
    // A doc comment is also a child node; its text is reached as trivia.
    if (ts.isJSDoc(node)) return;
    if (!ts.isToken(node)) {
      node.getChildren(sourceFile).forEach(visit);
      return;
    }
    if (node.kind !== ts.SyntaxKind.JsxText) {
      collect(ts.getTrailingCommentRanges(source, node.pos));
      collect(ts.getLeadingCommentRanges(source, node.pos));
    }
  };
  visit(sourceFile);
  return [...seen.values()].sort((a, b) => a.line - b.line);
}

/** The expression inside any parentheses, `as` casts, `satisfies` clauses and non-null assertions. */
export function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return unwrap(node.expression);
  }
  return node;
}

/** The name of a plain property key, or null for a computed one. */
export function keyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return null;
}

/** A property's value expression, or `undefined` when the key is absent, or null when it is hidden. */
export function propertyValue(
  object: ts.ObjectLiteralExpression,
  key: string,
): ts.Expression | undefined | null {
  let found: ts.Expression | undefined;
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      // A spread can carry the key; the object cannot be read with confidence.
      return null;
    }
    if (property.name === undefined || keyName(property.name) !== key) continue;
    if (ts.isPropertyAssignment(property)) found = property.initializer;
    else return null;
  }
  return found;
}

/** The text of a string literal (or a template with no substitution), else null. */
export function stringLiteral(node: ts.Expression): string | null {
  const inner = unwrap(node);
  return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) ? inner.text : null;
}

/** An array of string literals, or null when it is not one (a variable, a spread, a call). */
export function stringArray(node: ts.Expression): string[] | null {
  const inner = unwrap(node);
  const single = stringLiteral(inner);
  if (single !== null) return [single];
  if (!ts.isArrayLiteralExpression(inner)) return null;
  const out: string[] = [];
  for (const element of inner.elements) {
    const text = ts.isExpression(element) && !ts.isSpreadElement(element) ? stringLiteral(element) : null;
    if (text === null) return null;
    out.push(text);
  }
  return out;
}

/**
 * The string literals in an array, skipping anything else (a spread of
 * `configDefaults.exclude`, a variable). For lists that only narrow a set, where
 * dropping an unreadable entry can hide a finding but never invent one.
 */
export function literalStrings(node: ts.Expression): string[] {
  const inner = unwrap(node);
  const single = stringLiteral(inner);
  if (single !== null) return [single];
  if (!ts.isArrayLiteralExpression(inner)) return [];
  return inner.elements.flatMap((element) => {
    const text = ts.isExpression(element) && !ts.isSpreadElement(element) ? stringLiteral(element) : null;
    return text === null ? [] : [text];
  });
}

/** A regex literal's source, or a string's text, as a list (`testRegex` takes either, or an array). */
export function regexArray(node: ts.Expression): RegExp[] | null {
  const inner = unwrap(node);
  const items = ts.isArrayLiteralExpression(inner) ? [...inner.elements] : [inner];
  const out: RegExp[] = [];
  for (const item of items) {
    if (!ts.isExpression(item) || ts.isSpreadElement(item)) return null;
    const value = unwrap(item);
    try {
      if (ts.isRegularExpressionLiteral(value)) {
        const text = value.text;
        const slash = text.lastIndexOf('/');
        out.push(new RegExp(text.slice(1, slash), text.slice(slash + 1)));
        continue;
      }
      const text = stringLiteral(value);
      if (text === null) return null;
      out.push(new RegExp(text, 'u'));
    } catch {
      return null;
    }
  }
  return out;
}

/** The object a config module exports by default, unwrapping `defineConfig({...})` and a local const. */
export function exportedConfigObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
  let exported: ts.Expression | undefined;
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) exported = statement.expression;
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      statement.expression.left.getText(sourceFile) === 'module.exports'
    ) {
      exported = statement.expression.right;
    }
  }
  return exported === undefined ? null : resolveObject(sourceFile, exported, 0);
}

function resolveObject(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
  depth: number,
): ts.ObjectLiteralExpression | null {
  if (depth > 4) return null;
  const inner = unwrap(node);
  if (ts.isObjectLiteralExpression(inner)) return inner;
  if (ts.isCallExpression(inner) && inner.arguments.length === 1) {
    const argument = inner.arguments[0];
    return argument === undefined ? null : resolveObject(sourceFile, argument, depth + 1);
  }
  if (ts.isIdentifier(inner)) {
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === inner.text && declaration.initializer) {
          return resolveObject(sourceFile, declaration.initializer, depth + 1);
        }
      }
    }
  }
  return null;
}
