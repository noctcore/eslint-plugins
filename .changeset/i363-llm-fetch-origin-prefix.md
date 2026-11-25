---
'@noctcore/eslint-plugin-llm': patch
---

`no-llm-output-to-sink` reads the text before model output in a `fetch` URL the way the URL parser does. Output after only spaces or control characters (`` fetch(` ${text}`) ``), after a lone `/` followed by a tab or a line break, after `https:///` or `////` with no host closed yet, or after relative text it can finish into a scheme that leaves the origin (`` fetch(`h${text}`) `` with `text = 'ttps://evil.com'`) is now reported.
