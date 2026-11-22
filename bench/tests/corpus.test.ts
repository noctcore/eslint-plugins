import { describe, expect, it } from 'vitest';

import { CorpusError, hasOkMarker, loadCorpus, maskBenchComments, parseExpects, parseHeader } from '../src/corpus';
import { header, SHELL_CATEGORY, writeCorpus } from './helpers';

describe('labels', () => {
  it('reads the header fields, quoted or bare', () => {
    expect(parseHeader('// @bench category=ssrf cwe=CWE-918 pair=a-b title="two words"')).toEqual({
      category: 'ssrf',
      cwe: 'CWE-918',
      pair: 'a-b',
      title: 'two words',
    });
    expect(parseHeader('const x = 1;')).toBeNull();
  });

  it('reads expect labels with their lines, in line and block comments, several per comment', () => {
    const source = [
      'a(); // expect: security/no-shell-interpolation',
      'b();',
      '<div {/* expect: security/require-sanitized-html */} />',
      'c(); // expect: security/a-rule, security/b-rule',
    ].join('\n');
    expect(parseExpects(source)).toEqual([
      { rule: 'security/no-shell-interpolation', line: 1 },
      { rule: 'security/require-sanitized-html', line: 3 },
      { rule: 'security/a-rule', line: 4 },
      { rule: 'security/b-rule', line: 4 },
    ]);
  });

  it('accepts `// ok` only as a whole line', () => {
    expect(hasOkMarker('x();\n// ok\n')).toBe(true);
    expect(hasOkMarker('x(); // ok')).toBe(false);
  });

  it('blanks the bench comments without moving any line or column', () => {
    const source = `${header('p')}\nexec(cmd); // expect: security/require-path-containment\n// ok\nkeep(); // a normal comment\n`;
    const masked = maskBenchComments(source);
    expect(masked).toHaveLength(source.length);
    expect(masked.split('\n').map((l) => l.length)).toEqual(source.split('\n').map((l) => l.length));
    expect(masked).not.toContain('path-containment');
    expect(masked).not.toContain('@bench');
    expect(masked).toContain('exec(cmd);');
    expect(masked).toContain('// a normal comment');
  });
});

describe('loadCorpus', () => {
  it('loads a well-formed category', () => {
    const root = writeCorpus({
      'security/demo/category.json': SHELL_CATEGORY,
      'security/demo/p.vuln.js': `${header('p')}\nexec(\`ls \${d}\`); // expect: security/no-shell-interpolation\n`,
      'security/demo/p.safe.js': `${header('p')}\n// ok\nexecFile('ls', [d]);\n`,
    });
    const [category] = loadCorpus(root).categories;
    expect(category?.id).toBe('security/demo');
    expect(category?.cases.map((c) => [c.file, c.kind])).toEqual([
      ['security/demo/p.safe.js', 'safe'],
      ['security/demo/p.vuln.js', 'vuln'],
    ]);
  });

  it('lists every problem at once', () => {
    const root = writeCorpus({
      'security/demo/category.json': SHELL_CATEGORY,
      'security/demo/lonely.vuln.js': `${header('lonely')}\nexec(x); // expect: security/other-rule\n`,
      'security/demo/twin.safe.js': `${header('twin')}\nexec(x);\n`,
      'security/demo/wrong.vuln.js': `${header('other')}\n// ok\n`,
      'security/demo/Bad_Name.js': 'x',
    });
    let problems: readonly string[] = [];
    try {
      loadCorpus(root);
    } catch (error) {
      expect(error).toBeInstanceOf(CorpusError);
      problems = (error as CorpusError).problems;
    }
    const text = problems.join('\n');
    expect(text).toContain('Bad_Name.js: the name must be');
    expect(text).toContain('"security/other-rule" is not one of this category\'s rules');
    expect(text).toContain('twin.safe.js: a safe case needs a line that is only "// ok"');
    expect(text).toContain('the header says pair=other but the file name says wrong');
    expect(text).toContain('wrong.vuln.js: a vuln case needs an "// expect');
    expect(text).toContain('pair "lonely" has no safe twin');
    expect(text).toContain('pair "twin" has no vuln case');
  });

  it('only loads the named plugins', () => {
    const root = writeCorpus({
      'security/demo/category.json': SHELL_CATEGORY,
      'security/demo/p.vuln.js': `${header('p')}\nexec(\`ls \${d}\`); // expect: security/no-shell-interpolation\n`,
      'security/demo/p.safe.js': `${header('p')}\n// ok\n`,
    });
    expect(loadCorpus(root, ['electron']).categories).toEqual([]);
  });
});
