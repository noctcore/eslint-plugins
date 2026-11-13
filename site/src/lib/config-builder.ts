/**
 * The package page's config builder: start from a preset, flip single rules,
 * get the flat config that does exactly that. Pure, so the board's client
 * script, the server render and scripts/config-builder.test.ts share one
 * implementation. Takes catalog-shaped data as an argument and never imports
 * the generated catalog (CI's test job runs without a sync).
 */
import { importName } from './format';

export type Preset = 'recommended' | 'strict' | 'none';
export type Severity = 'error' | 'off';

export interface BuilderRule {
  readonly name: string;
  readonly id: string;
  readonly recommended: string | null;
  readonly strict: string | null;
  readonly requiresOptions: boolean;
  readonly deprecated?: boolean;
}

export interface BuilderPackage {
  readonly short: string;
  readonly npmName: string;
  readonly kind: string;
  readonly namespace: string | null;
  readonly rules: readonly BuilderRule[];
}

/** The placeholder a rule that needs options gets; the same text the rule pages point at. */
export const OPTIONS_PLACEHOLDER = "['error', { /* see the rule's Options */ }]";

/** `strict` is offered only where the package ships it, which shows as a rule listed in it. */
export function presetsOffered(pkg: BuilderPackage): Preset[] {
  return pkg.rules.some((rule) => rule.strict !== null) ? ['recommended', 'strict', 'none'] : ['recommended', 'none'];
}

/** `recommended`, unless it enables nothing and `strict` enables something, so the first view checks code. */
export function defaultPreset(pkg: BuilderPackage): Preset {
  const recommended = pkg.rules.some((rule) => rule.recommended === 'error');
  const strict = pkg.rules.some((rule) => rule.strict === 'error');
  return !recommended && strict ? 'strict' : 'recommended';
}

export function presetSeverity(rule: BuilderRule, preset: Preset): Severity {
  if (preset === 'recommended') return rule.recommended === 'error' ? 'error' : 'off';
  if (preset === 'strict') return rule.strict === 'error' ? 'error' : 'off';
  return 'off';
}

export function installCommand(pkg: BuilderPackage): string {
  const installed = pkg.kind === 'eslint-plugin' ? `${pkg.npmName} @typescript-eslint/parser` : pkg.npmName;
  return `npm install --save-dev ${installed}\n# or: bun add -D / pnpm add -D ${installed}`;
}

/**
 * The flat config for a preset plus overrides. An override equal to what the
 * preset already sets is not printed, so flipping a rule twice gives back the
 * preset's own snippet. Under a preset the overrides go in a second config
 * object: a preset is `{ name, plugins, rules }`, so a `rules` key written next
 * to its spread would replace the preset's whole rule map instead of adding to
 * it.
 */
export function configText(pkg: BuilderPackage, preset: Preset, overrides: Readonly<Record<string, Severity>>): string {
  if (pkg.kind !== 'eslint-plugin') throw new Error(`${pkg.npmName} is not an ESLint plugin; it has no flat config.`);
  if (!presetsOffered(pkg).includes(preset)) throw new Error(`${pkg.npmName} has no "${preset}" preset.`);
  const name = importName(pkg.short);
  const ruleLines = pkg.rules.flatMap((rule) => {
    const severity = overrides[rule.name];
    if (severity === undefined || severity === presetSeverity(rule, preset)) return [];
    const value = severity === 'off' ? "'off'" : rule.requiresOptions ? OPTIONS_PLACEHOLDER : "'error'";
    return [`      '${rule.id}': ${value},`];
  });
  const rulesBlock = ruleLines.length > 0 ? ['    rules: {', ...ruleLines, '    },'] : [];
  const files = "    files: ['**/*.{ts,tsx}'],";
  const parser = '    languageOptions: { parser: tsParser },';
  const objects =
    preset === 'none'
      ? [['  {', `    plugins: { '${pkg.namespace}': ${name} },`, files, parser, ...rulesBlock, '  },']]
      : [
          ['  {', `    ...${name}.configs.${preset},`, files, parser, '  },'],
          ...(rulesBlock.length > 0 ? [['  {', files, ...rulesBlock, '  },']] : []),
        ];
  return [
    '// eslint.config.js',
    "import tsParser from '@typescript-eslint/parser';",
    `import ${name} from '${pkg.npmName}';`,
    '',
    'export default [',
    ...objects.flat(),
    '];',
  ].join('\n');
}
