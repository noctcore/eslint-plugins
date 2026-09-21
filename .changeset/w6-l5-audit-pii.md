---
'@noctcore/eslint-plugin-observability': minor
---

Add `audit-pii-declared`: a PII-shaped key written into an audit payload (`metadata`, `before`, `after`) must be declared, either in `registeredFields` (the keys a purge job scrubs) or in `nonPiiFields`. Payloads it cannot read are reported unless `reportOpaque` is off. It enforces declaration, not deletion, and is inert until `auditCallees` is set. Enabled at `error` in `recommended`. `no-sensitive-fields-in-logs` now shares its name matcher from `utils`, with no behavior change.
