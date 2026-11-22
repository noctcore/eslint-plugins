# bench

A labeled corpus and a scorer that measure what each rule catches and what it wrongly reports.
Private workspace, never published. The scores are on the docs site at
[/bench/](https://noctcore.github.io/eslint-plugins/bench/).

```sh
bun run build                 # the bench imports each plugin from its built dist/
bun run bench                 # score, print the tables, write out/report.md and out/bench.sarif
bun run bench --check         # what CI runs: exit 1 on a regression or a stale baseline
bun run bench --update        # rewrite baseline.json after adding cases or improving a rule
bun run bench --plugin security
```

## How a case is written

One case per file under `corpus/<plugin>/<category>/`, named `<pair>.vuln.<ext>.case` or
`<pair>.safe.<ext>.case`. The trailing `.case` is deliberate: the corpus is vulnerable on purpose, and
code scanners (CodeQL runs on this public repo) and the repo's own `eslint .` only read known source
extensions, so they leave it alone. The scorer lints each case under its virtual name without `.case`
(`x.vuln.ts.case` as `x.vuln.ts`), so parsers and `files` globs behave as for real source. Point your
editor at `*.ts.case` as TypeScript if you want highlighting. The answer lives in the file:

```js
// @bench category=ssrf cwe=CWE-918 framework=express pair=express-link-preview title="link preview fetches the posted URL"
router.post('/preview', async (req, res) => {
  const response = await fetch(req.body.url); // expect: security/no-user-controlled-fetch-url
});
```

- **Line 1** is the header: `category` (the folder name), `cwe` (optional, `CWE-<n>`), `framework`
  (`express`, `koa`, `nest`, `node`, or whatever the plugin's shapes are), `pair` and a quoted `title`
  that says what the code does. The title is what the docs site lists.
- **A vulnerable case** is named `<pair>.vuln.<ext>.case` and carries `// expect: <plugin>/<rule>` on
  each line that must be reported. A report matches only when it starts on the labelled line (not when
  its range merely covers it), so put the label on the line where the reported node begins. Inside
  JSX, `{/* expect: <plugin>/<rule> */}` works too. The label states the truth about the code, not
  what any rule can see today.
- **A safe twin** is named `<pair>.safe.<ext>.case` (more twins: `<pair>.safe-2.<ext>.case`) and has a
  line that is only `// ok`. It has the same shape as its vulnerable twin and differs by the guard (for
  cookies: by the flags on the same cookie). A safe twin must be safe against real inputs, not just
  look guarded: `new URL(x, origin)` plus an origin check still lets `/.//evil.com` through as a
  pathname, `writeHead` does not encode a raw tab, an `execFile` argument can still be an option. Nest
  cases declare their `ValidationPipe` in the file, so a DTO decorator is never assumed to run.
- Every pair needs at least one of each. `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs` and `.cjs` (each followed
  by `.case`) all work; everything is parsed with `@typescript-eslint/parser`.
- The bench blanks its own comments (header, labels, `// ok`) before linting, column for column, so
  a rule never sees the answer.

Each category folder has a `category.json`:

```json
{
  "title": "Path traversal",
  "cwe": "CWE-22",
  "rules": ["security/require-path-containment"],
  "overrides": { "security/require-path-containment": "error" }
}
```

`rules` are the rules the category measures. `overrides` are ESLint rule entries layered over the
plugin's `recommended` preset for this folder only: that is how an opt-in rule is switched on, and
where options a real project would set are recorded (`["error", { "requestObjects": ["ctx"] }]`).
Keep them to what a consumer would actually configure; an override that only exists to make a number
look better defeats the point.

## How it scores

- Every `expect` label is one positive: **TP** when its rule reports a problem starting on that line,
  **FN** otherwise.
- Every safe case is one negative for each measured rule that runs on it: **FP** when that rule reports
  anything in the file, **TN** otherwise. A measured rule is any rule some category of the plugin lists
  in `rules`; it runs on a category when the preset or that category's `overrides` turn it on. So a
  preset rule is also charged for firing on another category's safe code.
- **Detection** = TP / (TP + FN), **false alarms** = FP / (FP + TN), **J** (Youden's J) = detection
  minus false alarms, per rule and per category, computed over a rule's own categories, where every
  case has a twin. Negatives from other categories are cases like any other (the ratchet guards them)
  and show as the "elsewhere" count (`crossFp` of `crossSafe`), but stay out of the rates, where
  hundreds of unrelated TNs would only dilute the false-alarm rate.
- A measured rule's report on an unlabelled line of a vulnerable case is an **extra**, shown in its own
  column: often a real false alarm on the code around the sink. Any other rule's report is "stray".
  Both show up in the SARIF log (`properties.benchRole`); neither moves the four counts.

## The baseline and the ratchet

`baseline.json` records the outcome of every case. `--check` compares case by case and fails when a
case got worse (TP to FN: a rule stopped catching something; TN to FP: a rule started firing on a safe
twin), and also when the file is merely out of date, so the site never shows stale numbers.

- **Adding cases a rule misses is fine.** Run `--update`; they are recorded as known gaps and the
  report lists them. The corpus may grow ahead of the rules.
- **Improving a rule** (FN to TP, FP to TN) updates the baseline in the same PR.
- **Accepting a regression** needs `--update --allow-regressions`, and shows up in the diff of
  `baseline.json` for review.
- **Removing cases**: `--update` lists every removed case, and refuses to drop one that was TP or TN
  (deleting a handled case is the other way to hide a regression) unless `--allow-removals` is passed.
  Renaming a case file counts as a removal plus an addition.

What this guarantees: no recorded case gets worse, and no handled case disappears, without a flag that
shows in review. It does not promise the rates only rise: adding a case a rule misses lowers its
detection, by design.

## Adding another plugin

The scorer is not security-specific. A plugin joins by having a folder and a dependency:

1. Add `"@noctcore/eslint-plugin-<short>": "workspace:*"` to this package's `devDependencies` and run
   `bun install`.
2. Create `corpus/<short>/<category>/category.json` and the cases. Labels name rules as
   `<short>/<rule>`.
3. Run `bun run bench --update` and commit the corpus and `baseline.json`.

What the first categories would look like:

- **electron**: `corpus/electron/` with categories such as `web-preferences` (`nodeIntegration: true`,
  `contextIsolation: false`, `sandbox: false` against the hardened twin), `ipc-sender` (a handler that
  trusts any sender against one that checks `event.senderFrame`) and `open-external` (`shell.openExternal`
  with a renderer URL against a scheme allowlist). `framework` would name the process: `main`,
  `preload`, `renderer`.
- **llm**: one category per defect the rule targets, for example a model id passed from a request
  against one picked from a registry; `framework` names the SDK (`openai`, `anthropic`, `ai-sdk`). The
  rule needs options to know the registry, so its `category.json` records them in `overrides`.
- **prisma**: categories such as `tenant-scope` (a `findMany` with no tenant filter against the scoped
  twin) and `raw-sql` (`$queryRawUnsafe` with interpolation against `$queryRaw` with a tagged template).
  Rules that read the Prisma schema need a fixture schema next to the cases; point the rule's options
  at it from `overrides`.

Style and convention plugins (architecture, code-quality) gain less from a paired corpus: their
question is precision on real code, which the real-code run in #275 measures.

## Rules

- Write the cases yourself. Do not copy files from other benchmarks; reading them for shapes is fine.
- No real secrets, hosts or project names in the corpus: `example.com`, invented service names.
- The corpus is sample code and is never run or installed.
