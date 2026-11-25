# DesignLens UI Audit and Feature Ideas

**Date:** 25 November 2026
**Scope:** Live dashboard layout and source-level interaction review. The active embedded browser viewport exposed a narrow-screen layout failure; a second visual review confirmed the corrected desktop layout. The final narrow viewport was not re-captured after the structure change.

**Feature update:** WCAG 2.2 checks, JSON/CSV downloads, rule-level scan comparison, and ten focused checks on the More Checks page were added after this initial audit. Some checks are static HTML signals; focus, zoom, form-error behavior, and PDF accessibility remain guided manual reviews. See the technical report for details.

## UI findings and fixes

| Finding | Impact | Change |
|---|---|---|
| Footer was a flex-row sibling of the main wrapper (`public/index.html`). At a narrow viewport the footer consumed the available row width and the main wrapper collapsed to 0 px, leaving page content squeezed/offscreen. | Critical usability issue; app appeared blank or clipped in the embedded mobile-width view. | Moved the footer inside `.main-wrapper`. The post-change desktop view showed the main content and footer sharing the wrapper width with no horizontal document overflow. |
| Closed issue/fix/lesson accordion panels used `max-height: 0` only. Links and buttons inside remained in the keyboard/accessibility sequence. | Keyboard and screen-reader users could reach content that appeared closed. | Added `inert` to initially closed panels and toggle it with the open state. Added `aria-controls` links for fix and lesson panels; issue panel already had an associated ID. |
| The mobile navigation moved off canvas with CSS but stayed focusable. `navigateTo` closed its visual state without resetting the opener's `aria-expanded` value. Escape did not close it. | Keyboard focus could disappear into hidden navigation and assistive technology could hear a stale menu state. | Centralized mobile drawer state: closed drawer is inert/hidden to accessibility APIs, opening/closing updates `aria-expanded`, focus returns to the trigger on dismiss, and Escape closes it. |
| Dashboard severity card said “Total Issues,” although its number is affected elements; the API separately reports rule violations. | Misleading metric labels. | Renamed it “Affected Elements.” |
| If the Chart.js CDN failed, `new Chart(...)` threw while rendering results and prevented the rest of the scan summary from completing. | A network/CDN outage could turn a successful API scan into an apparent UI failure. | Added a text-based severity summary fallback when Chart.js is unavailable. |
| Navigation focused the main region with default browser scrolling under a sticky 56 px topbar. | The initial heading could be partly hidden behind the topbar after navigation. | Focus main without auto-scroll, then scroll to page top while respecting reduced-motion preferences. |

## Follow-up UX issues to consider

- History “View” opens a summary alert, not the complete report. Rename it “Summary” or preserve bounded full reports in IndexedDB.
- Scan comparison now groups new, resolved, and persistent findings by rule ID and reports affected-element count changes. Matching individual selectors or nodes would make partial repairs easier to track.
- SPA navigation is not represented in the URL, so browser Back/Forward and deep links do not restore the selected section.
- Scan errors should be announced in a dedicated live region and inputs should expose `aria-invalid` while invalid.
- Full report restoration from the history view remains incomplete; saved history still contains only summaries and compact issue counts.
- CDN outages can still remove Bootstrap styling/icons and some chart behavior. Consider bundling UI dependencies locally for offline demos.

## Feature brainstorm for DesignLens

| Feature | User value | Status | Remaining effort | Academic value |
|---|---|---|---|---|
| WCAG 2.2 checks and version filter | Review newer criteria and make scan scope explicit. | WCAG 2.2 tags added | Low for version filter | Medium |
| Full report restore and finer scan diff | Return to a prior finding and track a fix by selector instead of comparing only rules. | Rule-level comparison added | Medium for report restore and target matching | Medium-high |
| Browser-rendered scan mode | Analyze JavaScript-rendered pages, computed styles, and rendered contrast. | Not implemented | High | High: browser automation, isolation, lifecycle, and resource limits |
| Same-site crawl with a strict page budget | Find issues beyond the landing page and summarize repeated patterns. | Not implemented | High | High: crawl graph, URL normalization, deduplication, and safe network policy |
| WCAG-mapped guided manual review | Pair automatic findings with a structured, clearly labeled human checklist per scan. | Existing global checklist only | Medium | Medium: coverage model and review workflow |
| JSON/CSV export and CI command | Let developers archive results or fail a build on configured severe findings. | JSON/CSV export added | Medium for CI command | High: API/CLI design and reproducible automation |
| Explainable prioritization | Rank work using severity, number of affected nodes, page location, and confidence, showing every factor. | Not implemented | Medium | High if evaluated with reviewers; keep it deterministic unless there is a labeled dataset. |
| Optional AI remediation drafts | Generate component-specific draft fixes from user-provided source snippets, with a human review step. | Not implemented | High | Potentially high, but only after privacy boundaries, provider costs, evaluation data, and fallback behavior are designed. |

### Recommended sequence

WCAG 2.2 checks, JSON/CSV export, and rule-level comparison are now added. Next, add an explicit version filter and full report restoration. Treat browser-rendered scanning as the major engineering project; it has the largest practical and academic value but needs stronger process and network isolation. Keep AI as an optional future experiment rather than describing existing axe rules as AI.

The More Checks page now includes link, table, page setup, alt-text review, media, form-error, control-name, focus/skip-link, zoom/reflow, and PDF review tools. Text heuristics and fetched-HTML results are prompts for review, not conformance decisions. The PDF checklist is manual and keeps the selected file on the user's device.
