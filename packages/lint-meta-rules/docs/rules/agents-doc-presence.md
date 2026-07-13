# `agents-doc-presence`

> An agent-contract doc must exist at the repo root, every surface, and every non-opted-out package.

## Why

An agent editing a boundary should read its guardrails first. Requiring an `AGENTS.md` (or whatever
doc you name) at the root and at every meaningful package means the contract is never missing where it
matters. A new package ships the doc by default; only trivial leaves opt out, and the opt-out is
explicit and reviewable.

## What it flags

Reports a missing doc at:

- the repo root (unless `requireAtRoot` is `false`),
- every directory derived from `surfaceGlobs` (all surfaces), and
- every directory derived from `packageGlobs`, except those in `optOut`.

## Factory

```ts
createAgentsDocPresenceRule(options?: AgentsDocPresenceOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `docFile` | `string` | `'AGENTS.md'` | The agent-contract filename required in each location. |
| `requireAtRoot` | `boolean` | `true` | Whether the repo root must carry the doc. |
| `surfaceGlobs` | `string[]` | `['apps/*/package.json']` | Surfaces (all require the doc). |
| `packageGlobs` | `string[]` | `['packages/*/package.json']` | Library packages (require the doc unless opted out). |
| `optOut` | `string[]` | `[]` | Package directories exempt from the requirement. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

De-projected from nightcore, which hardcoded `AGENTS.md`, the root/apps/packages layout and a fixed
leaf opt-out set.

## When not to use it

If your repo does not adopt an agent-contract doc convention, skip it.
