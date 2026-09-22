import { defineEcConfig } from '@astrojs/starlight/expressive-code';

/**
 * The rule docs mark every example ` ```ts bad ` or ` ```ts good `, and
 * scripts/sync.ts carries that through as `verdict=bad|good` fence meta. This
 * plugin turns it into a class on the rendered block so theme.css can give the
 * two a different frame, label colour and marker. Rendered identically, a reader
 * cannot tell which snippet is the one not to write.
 */
function pluginVerdict() {
  return {
    name: 'noctcore-verdict',
    hooks: {
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const verdict = codeBlock.metaOptions.getString('verdict');
        if (verdict !== 'bad' && verdict !== 'good') return;
        const props = renderData.blockAst.properties;
        const existing = Array.isArray(props.className) ? props.className : [];
        props.className = [...existing, `verdict-${verdict}`];
        props.dataVerdict = verdict;
      },
    },
  };
}

export default defineEcConfig({
  plugins: [pluginVerdict()],
});
