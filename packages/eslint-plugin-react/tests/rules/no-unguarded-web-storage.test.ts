import { ruleTester } from '@noctcore/eslint-test-utils';

import { noUnguardedWebStorageRule } from '../../src/rules/no-unguarded-web-storage';

const FILE = 'src/Theme.tsx';

ruleTester.run('no-unguarded-web-storage', noUnguardedWebStorageRule, {
  valid: [
    // Guarded directly.
    {
      code: `
function readTheme() {
  try {
    return localStorage.getItem('theme') ?? 'light';
  } catch {
    return 'light';
  }
}`,
      filename: FILE,
    },
    // Guarded at depth: the try is several statements and a callback above the call.
    {
      code: `
function persist(entries) {
  try {
    if (entries.length > 0) {
      for (const [key, value] of entries) {
        entries.forEach(() => {
          window.localStorage.setItem(key, value);
        });
      }
    }
  } catch {
    // ignore
  }
}`,
      filename: FILE,
    },
    // A try in an outer function around an inline callback counts as guarded.
    // It does not run when the callback fires later, but the rule errs toward silence.
    {
      code: `
function subscribe() {
  try {
    window.addEventListener('storage', () => {
      sessionStorage.removeItem('draft');
    });
  } catch {}
}`,
      filename: FILE,
    },
    // Every method is silent under a try, in either written form.
    {
      code: `
function sweep() {
  try {
    localStorage.clear();
    sessionStorage.key(0);
    window.localStorage.removeItem('a');
    globalThis.sessionStorage.setItem('b', '1');
    self.localStorage.getItem('c');
  } catch {}
}`,
      filename: FILE,
    },
    // A wrapper object is not the global; nothing to see here.
    { code: `const theme = safeStorage.get('theme');`, filename: FILE },
    { code: `storage.getItem('theme');`, filename: FILE },
    { code: `store.local.setItem('theme', 'dark');`, filename: FILE },
    { code: `window.appStorage.getItem('theme');`, filename: FILE },
    // A non-call reference to the object is not a call and cannot be wrapped.
    { code: `const storage = createJSONStorage(() => localStorage);`, filename: FILE },
    { code: `const store = window.sessionStorage;`, filename: FILE },
    { code: `const count = localStorage.length;`, filename: FILE },
    // A storage call written as TEXT inside a template literal is a string, not a
    // call expression. This is the inline boot-script shape.
    {
      code: `
export const BOOT_SCRIPT = [
  '(function(){var r=document.documentElement;',
  'try{',
  \`var m=localStorage.getItem(\${JSON.stringify(MODE_KEY)});\`,
  "if(m==='dark')r.classList.add('dark');",
  '}catch(e){}})()',
].join('');`,
      filename: FILE,
    },
    // A locally declared `localStorage` is a shim, not the global.
    {
      code: `
const localStorage = createMemoryStorage();
localStorage.setItem('theme', 'dark');`,
      filename: FILE,
    },
    {
      code: `
function withStorage(sessionStorage) {
  return sessionStorage.getItem('draft');
}`,
      filename: FILE,
    },
    // Default allowIn: tests, specs, __tests__, tests and e2e directories.
    { code: `localStorage.setItem('theme', 'dark');`, filename: 'src/theme.test.ts' },
    { code: `localStorage.setItem('theme', 'dark');`, filename: 'src/theme.spec.tsx' },
    { code: `localStorage.setItem('theme', 'dark');`, filename: 'src/__tests__/theme.ts' },
    { code: `localStorage.setItem('theme', 'dark');`, filename: '/abs/project/tests/setup.ts' },
    { code: `localStorage.setItem('theme', 'dark');`, filename: 'e2e/theme.ts' },
    // A custom allowIn list.
    {
      code: `localStorage.setItem('theme', 'dark');`,
      filename: 'src/electron/store.ts',
      options: [{ allowIn: ['**/electron/**'] }],
    },
  ],
  invalid: [
    // The canonical case: a bare read in a return statement. The suggestion wraps it.
    {
      code: `
function readTheme() {
  return localStorage.getItem('theme') ?? 'light';
}`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          data: { access: 'localStorage.getItem' },
          line: 3,
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `
function readTheme() {
  try {
    return localStorage.getItem('theme') ?? 'light';
  } catch {
    // Storage is unavailable or full. Fall back to the default.
  }
}`,
            },
          ],
        },
      ],
    },
    // The motivating case: a `typeof window` check guards the server, not the
    // browser-side throw. Both effects still fire. The `const` cannot be
    // wrapped without changing its scope, so the first report has no suggestion.
    {
      code: `
export function Boot() {
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setGone(true);
      return;
    }
    const alreadyBooted = window.sessionStorage.getItem(BOOT_STORAGE_KEY);
    if (alreadyBooted) {
      setGone(true);
      return;
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (ready || gone) {
      window.sessionStorage.setItem(BOOT_STORAGE_KEY, '1');
    }
  }, [ready, gone]);

  return null;
}`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          data: { access: 'window.sessionStorage.getItem' },
          line: 11,
        },
        {
          messageId: 'unguarded',
          data: { access: 'window.sessionStorage.setItem' },
          line: 22,
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `
export function Boot() {
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setGone(true);
      return;
    }
    const alreadyBooted = window.sessionStorage.getItem(BOOT_STORAGE_KEY);
    if (alreadyBooted) {
      setGone(true);
      return;
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (ready || gone) {
      try {
        window.sessionStorage.setItem(BOOT_STORAGE_KEY, '1');
      } catch {
        // Storage is unavailable or full. Fall back to the default.
      }
    }
  }, [ready, gone]);

  return null;
}`,
            },
          ],
        },
      ],
    },
    // Each method, each global prefix.
    {
      code: `globalThis.localStorage.removeItem('theme');`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          data: { access: 'globalThis.localStorage.removeItem' },
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `try {
  globalThis.localStorage.removeItem('theme');
} catch {
  // Storage is unavailable or full. Fall back to the default.
}`,
            },
          ],
        },
      ],
    },
    {
      code: `self.localStorage.clear();`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          data: { access: 'self.localStorage.clear' },
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `try {
  self.localStorage.clear();
} catch {
  // Storage is unavailable or full. Fall back to the default.
}`,
            },
          ],
        },
      ],
    },
    {
      code: `
function firstKey() {
  return sessionStorage.key(0);
}`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          data: { access: 'sessionStorage.key' },
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `
function firstKey() {
  try {
    return sessionStorage.key(0);
  } catch {
    // Storage is unavailable or full. Fall back to the default.
  }
}`,
            },
          ],
        },
      ],
    },
    {
      code: `
function save(theme) {
  window.localStorage.setItem('theme', theme);
}`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          data: { access: 'window.localStorage.setItem' },
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `
function save(theme) {
  try {
    window.localStorage.setItem('theme', theme);
  } catch {
    // Storage is unavailable or full. Fall back to the default.
  }
}`,
            },
          ],
        },
      ],
    },
    // Two unguarded calls draw two reports.
    {
      code: `
function readAll() {
  const mode = localStorage.getItem('mode');
  const palette = localStorage.getItem('palette');
  return { mode, palette };
}`,
      filename: FILE,
      errors: [
        { messageId: 'unguarded', line: 3 },
        { messageId: 'unguarded', line: 4 },
      ],
    },
    // A `catch` or `finally` body is not covered by its own try.
    {
      code: `
function reset() {
  try {
    hydrate();
  } catch {
    localStorage.removeItem('state');
  }
}`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          line: 6,
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `
function reset() {
  try {
    hydrate();
  } catch {
    try {
      localStorage.removeItem('state');
    } catch {
      // Storage is unavailable or full. Fall back to the default.
    }
  }
}`,
            },
          ],
        },
      ],
    },
    {
      code: `
function reset() {
  try {
    hydrate();
  } finally {
    sessionStorage.clear();
  }
}`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          line: 6,
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `
function reset() {
  try {
    hydrate();
  } finally {
    try {
      sessionStorage.clear();
    } catch {
      // Storage is unavailable or full. Fall back to the default.
    }
  }
}`,
            },
          ],
        },
      ],
    },
    // A sibling try does not enclose the call.
    {
      code: `
function boot() {
  try {
    hydrate();
  } catch {}
  localStorage.setItem('booted', '1');
}`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          line: 6,
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `
function boot() {
  try {
    hydrate();
  } catch {}
  try {
    localStorage.setItem('booted', '1');
  } catch {
    // Storage is unavailable or full. Fall back to the default.
  }
}`,
            },
          ],
        },
      ],
    },
    // Optional chaining does not stop the property access from throwing.
    {
      code: `window.localStorage?.getItem('theme');`,
      filename: FILE,
      errors: [
        {
          messageId: 'unguarded',
          data: { access: 'window.localStorage.getItem' },
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `try {
  window.localStorage?.getItem('theme');
} catch {
  // Storage is unavailable or full. Fall back to the default.
}`,
            },
          ],
        },
      ],
    },
    // No suggestion where wrapping would change the code's meaning: a `const`,
    // an expression-bodied arrow, a braceless `if`.
    {
      code: `const theme = localStorage.getItem('theme');`,
      filename: FILE,
      errors: [{ messageId: 'unguarded' }],
    },
    {
      code: `const readTheme = () => localStorage.getItem('theme');`,
      filename: FILE,
      errors: [{ messageId: 'unguarded' }],
    },
    {
      code: `if (ready) localStorage.setItem('booted', '1');`,
      filename: FILE,
      errors: [{ messageId: 'unguarded' }],
    },
    // A custom allowIn replaces the defaults, so a test file is no longer exempt.
    {
      code: `localStorage.setItem('theme', 'dark');`,
      filename: 'src/theme.test.ts',
      options: [{ allowIn: ['**/electron/**'] }],
      errors: [
        {
          messageId: 'unguarded',
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `try {
  localStorage.setItem('theme', 'dark');
} catch {
  // Storage is unavailable or full. Fall back to the default.
}`,
            },
          ],
        },
      ],
    },
    // An empty allowIn exempts nothing.
    {
      code: `localStorage.setItem('theme', 'dark');`,
      filename: 'src/theme.test.ts',
      options: [{ allowIn: [] }],
      errors: [
        {
          messageId: 'unguarded',
          suggestions: [
            {
              messageId: 'wrapInTry',
              output: `try {
  localStorage.setItem('theme', 'dark');
} catch {
  // Storage is unavailable or full. Fall back to the default.
}`,
            },
          ],
        },
      ],
    },
  ],
});
