---
---

Run the lockfile refresh twice in version-packages: bun 1.4.2 only rewrites the workspace versions and internal ranges in bun.lock on the second pass, so the Version Packages PR failed the lockfile check.
