import { defineEcConfig } from '@astrojs/starlight/expressive-code';

import { codeConfig } from './src/styles/code-theme.mjs';

/**
 * The rule docs mark every example ` ```ts bad ` or ` ```ts good `, and
 * scripts/sync.ts carries that through as `verdict=bad|good` fence meta. This
 * plugin turns it into a class on the rendered block so components.css can give the
 * two a different frame, label colour and marker. Rendered identically, a reader
 * cannot tell which snippet is the one not to write.
 */
function pluginVerdict() {
  return {
    name: 'noctcore-verdict',
    hooks: {
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const verdict = codeBlock.metaOptions.getString('verdict');
        if (verdict !== 'bad' && verdict !== 'good' && verdict !== 'report') return;
        const props = renderData.blockAst.properties;
        const existing = Array.isArray(props.className) ? props.className : [];
        props.className = [...existing, `verdict-${verdict}`];
        props.dataVerdict = verdict;
      },
    },
  };
}

/** The first element under `node` (itself included) that `test` accepts. */
function findElement(node, test) {
  if (node.type === 'element' && test(node)) return node;
  for (const child of node.children ?? []) {
    const found = findElement(child, test);
    if (found) return found;
  }
  return null;
}

const span = (className, value, extra = {}) => ({
  type: 'element',
  tagName: 'span',
  properties: { className: [className], ...extra },
  children: [{ type: 'text', value }],
});

/**
 * Splits a verdict frame title (`Incorrect · src/a/b/File.tsx · 2 reports`) into
 * parts, so that on a phone the start of the path can shrink to an ellipsis
 * while the verdict, the last folder and file name, and the count stay whole
 * (components.css, "frame titles"). The text is unchanged, so screen readers and
 * copy still get the full path, and the title attribute shows it on hover.
 * The code region is labelled with the same title: Expressive Code makes it a
 * focusable region when it scrolls sideways.
 */
export function splitFrameTitle(title) {
  const parts = title.split(' · ');
  const [verdict, path, ...rest] = parts;
  if (!path || !path.includes('/')) return null;
  const segments = path.split('/');
  const tail = segments.slice(-2).join('/');
  const head = path.slice(0, path.length - tail.length);
  return { verdict, head, tail, rest };
}

function pluginFrameTitle() {
  return {
    name: 'noctcore-frame-title',
    hooks: {
      // The frames plugin adds the title after the block hooks run, so this
      // works on the finished group.
      postprocessRenderedBlockGroup: ({ renderedGroupContents }) => {
        for (const { codeBlock, renderedBlockAst } of renderedGroupContents) {
          const verdict = codeBlock.metaOptions.getString('verdict');
          if (verdict !== 'bad' && verdict !== 'good') continue;
          const text = codeBlock.props.title;
          if (!text) continue;
          const pre = findElement(renderedBlockAst, (n) => n.tagName === 'pre');
          if (pre) pre.properties.ariaLabel = `${text}, code`;
          const title = findElement(renderedBlockAst, (n) => (n.properties?.className ?? []).includes('title'));
          const split = splitFrameTitle(text);
          if (!title || !split) continue;
          title.properties.title = text;
          title.children = [
            span('t-verdict', `${split.verdict} · `),
            span('t-head', split.head),
            span('t-tail', split.tail),
            ...split.rest.map((part) => span('t-rest', ` · ${part}`)),
          ];
        }
      },
    },
  };
}

export default defineEcConfig({
  ...codeConfig(),
  plugins: [pluginVerdict(), pluginFrameTitle()],
});
