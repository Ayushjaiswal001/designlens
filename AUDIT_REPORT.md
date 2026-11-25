# DesignLens Repository Audit

**Repository:** Abhi-Git44u/designlens

**Audited revision:** 4db5519 (initial commit)

**Audit date:** 25 November 2026
**Scope note:** The supplied project brief names “S Campus Care,” but this repository is DesignLens, a website accessibility analyzer. Findings and repairs here describe the checked-out DesignLens code only.

## Repository condition

- Single-page vanilla HTML/CSS/JavaScript frontend served by Express.
- One POST API endpoint fetches a submitted URL, parses it with JSDOM, runs axe-core, and returns accessibility findings and metadata.
- No database, accounts, AI model, campus-care workflow, deployment configuration, tests, lockfile, or installed node_modules were present at audit start.
- Scan history and checklist data are stored in browser localStorage/sessionStorage.
- A substantial pre-existing `README-ANALYSIS.md` describes prior experiments and findings; these are treated as unverified historical notes, not as this audit's test evidence.

## Dependency map

```text
Browser UI (public/index.html + app.js + style.css)
  ├─ Bootstrap / Icons / Chart.js via CDN
  ├─ same-origin POST /api/analyze { url }
  └─ localStorage/sessionStorage for client-only state
       ↓
Express server (server.js)
  ├─ Helmet, CORS, rate limiter, JSON parser, static files
  └─ backend/analyzer.js
       ├─ Axios fetch of user-supplied URL
       ├─ JSDOM parse and axe-core scan
       └─ JSON result → browser rendering
```

## Findings before repair

| ID | Severity | Location | Root cause and impact | Recommended solution / status |
|---|---|---|---|
| A1 | Critical | `server.js` URL validation; `backend/analyzer.js` `fetchHtml`, `runAxe` | Hostname prefix blocklist did not safely classify IP ranges or DNS answers. Redirect following and JSDOM resource loading could reach internal hosts. User-controlled remote scripts were enabled in the analyzer process. This created SSRF and code-execution/availability risks. | **Addressed:** classify literal/DNS IPs, pin validated DNS, disable redirects/proxies/scripts/subresources. Network-level egress restrictions remain recommended. |
| A2 | High | `backend/analyzer.js` `analyzeUrl` and analysis lifecycle | The Axios timeout covered only initial HTTP fetch. JSDOM work had no hard analysis deadline and ran in the API process. | **Addressed:** worker-thread isolation with 20-second deadline and two concurrent slots; worker is not an OS memory sandbox. |
| A3 | High | `server.js` `/api/analyze` catch block | Raw analysis messages were returned to clients, potentially exposing implementation details. | **Addressed:** generic errors, request IDs, detailed server-side logs, and specific status mapping. |
| A4 | Medium | `backend/analyzer.js` `severityCounts`; `public/js/app.js` `renderScanResults` | Severity counts represent affected elements, while some UI labels are generic. This can confuse rule counts with affected-node counts. | **Partly addressed/documented:** API docs distinguish `totalViolations` (rules) from `totalIssues`/severity counts (affected nodes); UI labels could be made more explicit. |
| A5 | Medium | `public/js/app.js` `pushHistory` / `renderHistory` / comparison handler | “View” presents only a summary alert; compact history does not restore a full report. The earlier comparison only compared totals. | **Partly addressed:** issue comparison now reports new/resolved/persistent rules and affected-count changes. Full report restoration remains open. |
| A6 | Medium | `public/js/app.js` `doScan` | A failed scan could leave prior results visible without clearly identifying them as stale. | **Addressed:** hide the previous scan result panel when a valid new scan starts. |
| A7 | Medium | `public/js/app.js` `parseColor` and `updateContrast` | Invalid color input could yield a NaN ratio and misleading status badges. JSDOM cannot measure rendered contrast. | **Addressed/documented:** validate color values and present an explicit invalid-input state; retain clear limitation about scanned-page contrast. |
| A8 | Medium | `package.json`, `.gitignore` | Runtime range claimed Node 16 although JSDOM 23 needs a newer runtime; package lock was ignored. No automated tests or health endpoint existed. | **Addressed:** Node 18 floor, tracked lockfile, test script, health endpoint, and 11 automated tests. |
| A9 | Low | `README.md`, `README-ANALYSIS.md`, project identity | Documentation did not state key limits (static HTML only, no SPA render, database/auth, or AI). The supplied “S Campus Care” scope did not match the repository. | **Addressed:** README/report describe DesignLens only; prior analysis marked historical and superseded. |

## Architecture and capability assessment

This is a conventional browser → Express → URL fetch → JSDOM/axe pipeline. It is not an AI/ML project: axe-core is a deterministic accessibility rule engine, not a learned model. JSDOM evaluates the returned static document, not a fully rendered browser page; layout-dependent checks such as contrast and client-rendered single-page applications cannot be reliably assessed by this pipeline. There is no user database or server-side history.

## Planned stabilization

1. Restrict fetches to public DNS-resolved IP addresses, pin the validated resolution, and disallow redirects.
2. Disable untrusted page scripts and subresources; isolate axe work with a hard deadline and bounded concurrency.
3. Return generic client errors with request IDs and retain details only in server logs.
4. Make the app serve same-origin requests without permissive CORS and define a restrictive CSP compatible with its CDN assets.
5. Add reproducible dependency locking and focused unit/API tests; document actual limitations and results.

## Verification status

At audit time no tests had been run. After stabilization and feature additions, 11 automated tests passed, including checks for the added static analysis data. A live public scan completed, a private-target request was rejected, and `npm audit` reported zero vulnerabilities. JSON/CSV downloads and saved-scan comparison were checked manually in the browser; the latest More Checks interface was not visually verified. Exact evidence and limitations are recorded in `docs/TECHNICAL_AND_ACADEMIC_REPORT.md`.
