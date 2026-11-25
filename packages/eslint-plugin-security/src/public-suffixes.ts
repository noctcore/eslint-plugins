/**
 * Common public suffixes: domains under which anyone can register a name of
 * their own, so `evil.vercel.app` or `evil.co.uk` belongs to whoever asked
 * for it. A host regex that ends in one of these pins nothing unless at least
 * one more literal label comes before it (`^[a-z0-9-]+\.myapp\.vercel\.app$`).
 *
 * This is a short built-in list, read without a network fetch, not the whole
 * Public Suffix List. A suffix missing from it keeps the plain rule: a domain
 * of at least two labels.
 */
const PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  // Hosting and preview deploys.
  'vercel.app',
  'now.sh',
  'netlify.app',
  'netlify.com',
  'github.io',
  'githubusercontent.com',
  'gitlab.io',
  'pages.dev',
  'workers.dev',
  'herokuapp.com',
  'herokussl.com',
  'firebaseapp.com',
  'web.app',
  'appspot.com',
  'run.app',
  'cloudfunctions.net',
  'azurewebsites.net',
  'azurestaticapps.net',
  'azureedge.net',
  'cloudapp.net',
  'cloudfront.net',
  'amazonaws.com',
  'elasticbeanstalk.com',
  'amplifyapp.com',
  'onrender.com',
  'fly.dev',
  'up.railway.app',
  'glitch.me',
  'repl.co',
  'replit.dev',
  'surge.sh',
  'ngrok.io',
  'ngrok.app',
  'ngrok-free.app',
  'deno.dev',
  'blogspot.com',
  'wixsite.com',
  'myshopify.com',
  'readthedocs.io',
  'bitbucket.io',
  'codeberg.page',
  'pythonanywhere.com',
  'digitaloceanspaces.com',
  'ondigitalocean.app',
  'b-cdn.net',
  'r2.dev',
  'trycloudflare.com',
  'loca.lt',
  // Second-level domains of country codes.
  'co.uk',
  'org.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'net.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'id.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'co.kr',
  'or.kr',
  'com.br',
  'net.br',
  'org.br',
  'com.cn',
  'net.cn',
  'org.cn',
  'com.hk',
  'com.tw',
  'com.sg',
  'com.my',
  'com.ph',
  'co.id',
  'co.in',
  'net.in',
  'org.in',
  'co.il',
  'co.za',
  'com.mx',
  'com.ar',
  'com.co',
  'com.tr',
  'com.ua',
  'com.pl',
  'com.es',
  'com.pt',
  'com.ru',
  'co.th',
  'com.vn',
  'com.eg',
  'com.sa',
  'com.ng',
  'co.ke',
]);

/**
 * Public suffixes with a label that varies, as in the Public Suffix List: a
 * `*` label is any one label (a region such as `us-east-1`), and a `*` inside
 * a label is any run of characters in it (`s3-*` covers `s3-us-west-2`).
 */
const PUBLIC_SUFFIX_PATTERNS: readonly (readonly RegExp[])[] = [
  's3.amazonaws.com',
  's3.*.amazonaws.com',
  's3-*.amazonaws.com',
  's3-website.*.amazonaws.com',
  's3.dualstack.*.amazonaws.com',
  's3-accesspoint.*.amazonaws.com',
  'compute.amazonaws.com',
  '*.compute.amazonaws.com',
  'compute-1.amazonaws.com',
  '*.elb.amazonaws.com',
  'execute-api.*.amazonaws.com',
  '*.elasticbeanstalk.com',
  'lambda-url.*.on.aws',
  '*.awsapprunner.com',
  'blob.core.windows.net',
  'web.core.windows.net',
  '*.web.core.windows.net',
  'storage.googleapis.com',
  'firebasestorage.app',
].map((pattern) =>
  pattern
    .split('.')
    .map((label) =>
      label === '*'
        ? /^[^.]+$/u
        : new RegExp(`^${label.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^.]*')}$`, 'u'),
    ),
);

function isPublicSuffix(labels: readonly string[]): boolean {
  return (
    PUBLIC_SUFFIXES.has(labels.join('.')) ||
    PUBLIC_SUFFIX_PATTERNS.some(
      (pattern) =>
        pattern.length === labels.length && pattern.every((matcher, index) => matcher.test(labels[index] ?? '')),
    )
  );
}

/**
 * How many labels the longest listed public suffix at the end of `domain`
 * has, or 1 (the top-level domain) when none is listed.
 */
export function publicSuffixLabels(domain: string): number {
  const labels = domain.toLowerCase().split('.');
  for (let start = 0; start < labels.length - 1; start += 1) {
    if (isPublicSuffix(labels.slice(start))) {
      return labels.length - start;
    }
  }
  return 1;
}
