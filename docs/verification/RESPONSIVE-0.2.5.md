# Responsive verification — public + control portals

**Date:** 2026-08-25  
**Version:** 0.2.5

## Changes

- Portal sticky sidebar collapses to drawer at **960px** (phone + tablet)
- Public header hamburger also at 960px
- Form / permission / gallery grids collapse earlier
- Ops metrics style `article` cards; panels get inner padding
- Missing CSS tokens (`--surface`, `--border`, `--oman-teal`, …) defined
- Safe-area padding on site header + portal mobile bar
- Playwright: Pixel 7 + iPad Mini; overflow assertion; portal menu open on mobile

## Checks

| Surface                          | Phone                       | Tablet       | Desktop        |
| -------------------------------- | --------------------------- | ------------ | -------------- |
| Public home / listings           | e2e overflow                | e2e overflow | chromium smoke |
| Portal owner/dev/tenant/platform | drawer + overflow           | drawer       | sidebar        |
| Ops console / property manager   | padded panels + 1-col forms | same         | multi-col      |

## Residual

Wide ops data tables still scroll horizontally by design (nowrap); primary actions remain reachable.
