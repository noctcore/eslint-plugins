# Banner

The README header and social preview follow the noctcore blueprint brand
([`noctcore/.github` `brand/BRAND.md`](https://github.com/noctcore/.github/blob/main/brand/BRAND.md)).
They are generated, not hand edited: the source is
`brand/specs/eslint-plugins.json` in `noctcore/.github`, rendered with
`node render.mjs ../specs/eslint-plugins.json <out>` from `brand/generator`.

The diagram: source code passes three plugin families on its way to a clean
lint run. `contracts` stops a fetch whose response is never checked
(`fetch-must-check-ok`), `async-safety` stops a fetch with no timeout
(`require-fetch-timeout`) and `security` stops shell interpolation
(`no-shell-interpolation`). It is an introduction, not the full rule list.

| File | Purpose |
| --- | --- |
| `readme-header-dark.svg` | 1280 x 360 header for a dark surface |
| `readme-header-light.svg` | 1280 x 360 header for a light surface |
| `social-preview.svg` / `.png` | 1280 x 640 social preview; upload the PNG in Settings, General, Social preview |

All lettering is outlined: the SVGs load no fonts, scripts or images.
Manrope and DM Mono are used under the SIL Open Font License 1.1.
