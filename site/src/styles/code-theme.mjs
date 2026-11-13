/* Expressive Code settings for the inspection-sheet theme.

   Code panels are dark ink in both site themes, so there is one dark
   Expressive Code theme. Its token colours are the --sheet-code-* tokens of
   tokens.css converted to sRGB hex (Expressive Code needs real colours to
   build a theme; scripts/theme.test.ts checks the two stay equal). Frames,
   borders and the panel background read the tokens directly, so the dark
   theme's deeper panel follows the token flip.

   - useStarlightUiThemeColors: false. Starlight's UI colours flip with the
     page theme, and the panels must not.
   - minSyntaxHighlightingColorContrast: 0. By default Expressive Code nudges
     token colours toward a contrast it computes against a fixed grey, not the
     real panel. These colours are checked against the real panel instead:
     every pair is in theme.test.ts. */
import { ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code';

/** sRGB hex of the code tokens in tokens.css, in the order they are declared there. */
export const CODE_COLORS = {
  '--sheet-code-bg': '#161e2e',
  '--sheet-code-fg': '#dde1ea',
  '--sheet-code-dim': '#8b93a0',
  '--sheet-code-kw': '#b5b2f5',
  '--sheet-code-str': '#9bddac',
  '--sheet-code-num': '#f5c07c',
  '--sheet-code-fn': '#96d5f1',
};

/* TextMate scopes per token role, for the TypeScript, JavaScript, shell and
   JSON grammars the docs use. */
const ROLE_SCOPES = [
  ['--sheet-code-dim', ['comment', 'punctuation.definition.comment'], 'italic'],
  ['--sheet-code-kw', ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control', 'constant.language', 'variable.language']],
  ['--sheet-code-str', ['string', 'string.template', 'punctuation.definition.string', 'punctuation.definition.template-expression']],
  ['--sheet-code-num', ['constant.numeric', 'constant.other']],
  ['--sheet-code-fn', ['entity.name.function', 'support.function', 'meta.function-call entity.name.function', 'entity.name.type', 'support.type', 'support.class', 'entity.name.class', 'entity.name.command']],
  ['--sheet-code-fg', ['variable.other.property', 'meta.object-literal.key', 'support.type.property-name', 'entity.other.attribute-name']],
  ['--sheet-code-dim', ['punctuation', 'meta.brace', 'keyword.operator']],
];

function colorRules() {
  return ROLE_SCOPES.map(([role, scope, fontStyle]) => ({
    scope,
    settings: fontStyle ? { foreground: CODE_COLORS[role], fontStyle } : { foreground: CODE_COLORS[role] },
  }));
}

function sheetTheme() {
  return new ExpressiveCodeTheme({
    name: 'sheet-ink',
    type: 'dark',
    colors: {
      'editor.background': CODE_COLORS['--sheet-code-bg'],
      'editor.foreground': CODE_COLORS['--sheet-code-fg'],
    },
    tokenColors: colorRules(),
  });
}

/** Everything ec.config.mjs needs; spread it and add the site's plugins. */
export function codeConfig() {
  return {
    themes: [sheetTheme()],
    useStarlightUiThemeColors: false,
    minSyntaxHighlightingColorContrast: 0,
    styleOverrides: {
      borderColor: 'var(--sheet-code-line)',
      borderRadius: 'var(--sheet-radius)',
      codeBackground: 'var(--sheet-code-bg)',
      codeForeground: 'var(--sheet-code-fg)',
      codeFontFamily: 'var(--sheet-font-code)',
      codeFontSize: '0.84375rem',
      codeLineHeight: '1.7',
      uiFontFamily: 'var(--sheet-font-code)',
      uiFontSize: '0.78125rem',
      focusBorder: 'var(--sheet-focus)',
      scrollbarThumbColor: 'var(--sheet-code-line)',
      scrollbarThumbHoverColor: 'var(--sheet-code-dim)',
      frames: {
        editorBackground: 'var(--sheet-code-bg)',
        editorTabBarBackground: 'var(--sheet-code-bg)',
        editorTabBarBorderColor: 'transparent',
        editorTabBarBorderBottomColor: 'var(--sheet-code-line)',
        editorActiveTabBackground: 'var(--sheet-code-bg)',
        editorActiveTabForeground: 'var(--sheet-code-dim)',
        editorActiveTabBorderColor: 'transparent',
        editorActiveTabIndicatorTopColor: 'transparent',
        editorActiveTabIndicatorBottomColor: 'transparent',
        editorActiveTabIndicatorHeight: '0px',
        terminalBackground: 'var(--sheet-code-bg)',
        terminalTitlebarBackground: 'var(--sheet-code-bg)',
        terminalTitlebarForeground: 'var(--sheet-code-dim)',
        terminalTitlebarBorderBottomColor: 'var(--sheet-code-line)',
        terminalTitlebarDotsForeground: 'var(--sheet-code-line)',
        terminalTitlebarDotsOpacity: '1',
        frameBoxShadowCssValue: 'none',
        inlineButtonForeground: 'var(--sheet-code-dim)',
        inlineButtonBackground: 'var(--sheet-code-bg-2)',
        inlineButtonBorder: 'var(--sheet-code-line)',
        tooltipSuccessBackground: 'var(--sheet-pass)',
        tooltipSuccessForeground: 'var(--sheet-code-bg)',
      },
      textMarkers: {
        markBackground: 'transparent',
        markBorderColor: 'transparent',
      },
    },
  };
}
