# DesignLens — Project Analysis, Security Audit & Improvement Roadmap

> **Historical snapshot:** This document describes a review performed against a different checkout path and predates the stabilization work in this branch. Its reported experiments, dependency inventory, scores, and claims are not current verification evidence. Use [AUDIT_REPORT.md](AUDIT_REPORT.md) and [docs/TECHNICAL_AND_ACADEMIC_REPORT.md](docs/TECHNICAL_AND_ACADEMIC_REPORT.md) for the audit and tests performed against this repository revision.

> **Document type:** Independent project review, weakness audit, and feature roadmap
> **Project:** DesignLens — Website Accessibility Analyzer (`C:\Users\shiva\mini\miniproject`)
> **Reviewed:** 23 November 2026
> **Companion file:** the original `README.md` is intentionally left unchanged. This document records where the project actually stands today, what is broken or risky, and what to build next.

---

## 0. TL;DR

DesignLens is a **feature-rich, visually polished college mini-project** with a working end-to-end scan flow, 12 front-end pages, a real axe-core integration, and sensible beginner-friendly explanations. For a mini-project, it is **above average (≈7/10)**.

It is **not production-ready (≈3/10)**. The review found **one confirmed denial-of-service**, **multiple SSRF filter bypasses**, a **fundamental accuracy gap in contrast checking**, and several correctness/accessibility bugs that undermine trust in the results.

### The five findings that matter most

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **Critical** | The server executes **untrusted third-party JavaScript in the main Node process** and lets jsdom load **unbounded external subresources**. A single scan of `wikipedia.org` **hard-hung the entire server** (>90 s unresponsive, CPU climbing 278 s → 370 s, RSS 183 MB → 237 MB). | `backend/analyzer.js:64-80`; live test; process had to be killed |
| 2 | **Critical** | The SSRF blocklist is a **string-prefix check** and is bypassable. `[::1]`, `127.0.0.2`, `172.17.x.x`–`172.31.x.x`, `[::ffff:127.0.0.1]`, `metadata.google.internal`, DNS rebinding, redirects, and jsdom subresources all bypass it. It also **false-positives** on `10.example.com`. | `server.js:67-76`; live test matrix below |
| 3 | **Critical** | There is **no hard timeout or process isolation** around analysis. The 15 s timeout only covers the initial `axios` fetch; DOM parsing, script execution, and subresource loading are unbounded. | `backend/analyzer.js:10, 39-80` |
| 4 | **High** | **`color-contrast` never becomes a violation in jsdom.** In a controlled probe, obviously failing text (`#aaaaaa` on `#ffffff`) landed in `incomplete`, not `violations`. The app’s headline “WCAG 2.1 AA” claim is therefore misleading for contrast. | Probe script; axe-core in jsdom |
| 5 | **High** | The **score, history, and comparison are shallower than the UI suggests**. The score is an ad-hoc element-count penalty; history cannot restore a report (“View” is an `alert()`); comparison only compares summary numbers, not issues. | `app.js:236-241, 1234-1353` |

### The three highest-value quick wins

1. **Stop the DoS and SSRF**: disable `runScripts`/`resources` in jsdom, add a hard worker/child-process timeout, and replace the hostname blocklist with DNS resolution + IP-range validation.
2. **Fix trust in results**: compute a transparent, normalized score server-side; separate “rules failed” from “elements affected”; add the missing **Minor** card; show **incomplete / needs review** details.
3. **Fix the report lifecycle**: persist full scan results (IndexedDB or DB), restore them on “View”, and make Before/After an issue-level diff.

---

## 1. How this review was done

| Activity | Method |
|---|---|
| Source review | Read every project file outside `node_modules` (3,092 lines total) |
| Live smoke test | Ran the existing dev server on `http://localhost:3000` and scanned `https://example.com` |
| Adversarial test | Sent SSRF payloads to `/api/analyze` and observed status codes |
| Behaviour probe | Ran jsdom + axe-core against a controlled local HTML fixture to test script execution, subresource fetching, and contrast detection |
| Dependency audit | `npm audit`, `npm outdated`, installed-version inspection |
| Header/route audit | Inspected response headers, API GET behaviour, and missing-asset behaviour |
| Self-accessibility audit | Calculated WCAG contrast ratios for the app’s own colour tokens |
| Availability test | Scanned a real-world site (`wikipedia.org`) and monitored server responsiveness, CPU, and memory |

**Important note:** the availability test caused the running dev server to hang. I terminated the stuck process (PID 24292) and restarted it (PID 27868), then verified `HTTP 200`. No project source files were modified; only this document was added.

---

## 2. Project snapshot

### 2.1 What it is

A single-page web app where a user enters a public URL; the Express backend fetches the HTML, runs **axe-core** inside **jsdom**, and returns accessibility violations, page metadata, and fix guidance. The frontend presents a dashboard, issue explorer, fix assistant, contrast checker, alt-text analyzer, keyboard checklist, heading analyzer, form checker, local history, before/after comparison, and a learning hub.

### 2.2 Stack

| Layer | Technology | Installed version |
|---|---|---|
| Runtime | Node.js | v24.19.0 (project declares `>=16`) |
| Server | Express | 4.22.3 |
| HTTP client | axios | 1.21.1 |
| DOM emulation | jsdom | 23.2.0 |
| Accessibility engine | axe-core | 4.14.1 |
| Security | helmet, cors, express-rate-limit | 7.2.0 / 2.8.6 / 7.5.1 |
| Frontend | Vanilla JS, Bootstrap 5, Bootstrap Icons, Chart.js (CDN) | Bootstrap 5.3.2, Chart.js 4.4.1 |
| Persistence | `localStorage` / `sessionStorage` | Browser-only |
| Dev tooling | nodemon | 3.1.14 |

### 2.3 Structure

```
miniproject/
├── backend/
│   └── analyzer.js        (189 lines)  fetch → jsdom → axe → format
├── public/
│   ├── index.html         (707 lines)  12 SPA pages in one file
│   ├── css/style.css      (687 lines)  custom design system
│   └── js/app.js          (1,406 lines) all frontend logic
├── server.js              (103 lines)  Express server + 1 API route
├── package.json
├── package-lock.json
└── README.md              (original, now outdated)
```

### 2.4 Size and shape

| Metric | Value |
|---|---|
| Total hand-written lines | **3,092** |
| Frontend JS | 1,406 lines, one file, global state |
| HTML | 707 lines, 12 hidden/active page sections |
| CSS | 687 lines, custom properties + partial dark theme |
| Backend | 292 lines across 2 files |
| API endpoints | **1** (`POST /api/analyze`) |
| Pages | **12** |
| Tests | **0** |
| Lint/format/type configs | **0** |
| CI/CD | **0** |
| Docker/deploy config | **0** |
| Database | **0** |
| Auth/accounts | **0** |

### 2.5 Dependency reality check

`package.json` declares older ranges (`^4.8.3`, `^23.0.1`, etc.) but the lockfile has drifted forward inside those ranges:

| Package | Declared | Installed | Latest | Gap |
|---|---|---|---|---|
| express | `^4.18.2` | 4.22.3 | **5.3.0** | major behind |
| jsdom | `^23.0.1` | 23.2.0 | **31.0.1** | 8 majors behind |
| helmet | `^7.1.0` | 7.2.0 | **8.3.0** | major behind |
| express-rate-limit | `^7.1.5` | 7.5.1 | **8.7.5** | major behind |
| axe-core | `^4.8.3` | 4.14.1 | 4.14.1 | current |
| axios | `^1.6.2` | 1.21.1 | current | current |
| cors | `^2.8.5` | 2.8.6 | current | current |

`npm audit` result: **2 moderate, 0 high, 0 critical** — both from `nodemon → minimatch` (dev-only). Production dependencies are currently clean, but the project is behind on four majors.

**Engine mismatch:** `package.json` says `"node": ">=16.0.0"`, but jsdom 23 requires **Node ≥18**, and Node 16 is end-of-life. The app was verified on Node 24.

---

## 3. Where the project stands

### 3.1 Maturity scorecard

Scores are relative to what the category demands, not to a beginner baseline.

| Dimension | Score | Assessment |
|---|---:|---|
| Feature breadth | **7.5 / 10** | 12 pages, real scan flow, many useful tools; impressive scope for a mini-project |
| Visual design / UX | **6.5 / 10** | Clean, modern, responsive, dark mode; some flows are shallower than they look |
| Core analysis accuracy | **4 / 10** | axe-core is real, but jsdom cannot do layout/contrast; single page only; no SPA wait |
| Security | **2.5 / 10** | Good intentions (helmet, rate limit, blocklist) undermined by bypasses and in-process script execution |
| Reliability / performance | **3 / 10** | Confirmed full-server DoS; no hard timeout, queue, worker isolation, or concurrency limit |
| Accessibility of the tool itself | **6 / 10** | Skip link, labels, focus styles, live regions; but contrast failures, focusable collapsed content, no reduced-motion |
| Code quality / maintainability | **5 / 10** | Readable and consistent, but two monoliths, global state, duplicated fix data, dead data, no tests |
| Documentation | **4 / 10** | README exists and is friendly, but outdated and contains a factually wrong claim about jsdom |
| Production readiness / DevOps | **1.5 / 10** | No tests, CI, env config, Docker, DB, logging, health checks, graceful shutdown |
| Dependency health | **6 / 10** | No high/critical vulns; four majors behind; floating ranges |

**Overall: ≈7/10 as a college mini-project; ≈3/10 as a production accessibility service.**

### 3.2 What genuinely works (verified)

- **End-to-end scan works.** `POST /api/analyze` with `https://example.com` returned in **1.2 s**: 7 affected elements, 1 rule violation (`region`), 9 rules passed, 4 incomplete.
- **axe-core is integrated correctly at a basic level** — WCAG 2.0/2.1 A/AA + best-practice tags, per-node HTML snippets, failure summaries, help URLs.
- **The UI is cohesive.** Sidebar navigation, responsive layout, skip link, visible focus on many controls, dark mode, empty states, and disclaimers are all present.
- **The “how to fix” content is a real strength.** Before/after snippets, “why it matters”, “who is affected”, and copy buttons are excellent for learning.
- **The standalone contrast checker math is correct** for hex/RGB solid colours (relative luminance + 4.5/3/7 ratios).
- **Security intent is visible**: helmet headers are present, CORS is restricted, JSON body size is capped at 10 KB, URLs are validated, and rate limiting exists.
- **The original README is beginner-friendly** and accurately explains setup, usage, and the limits of automated testing (apart from the jsdom claim).

### 3.3 What is partial or misleading

| Area | Reality |
|---|---|
| “WCAG 2.1 AA analyzer” | Includes `best-practice` rules and does not include WCAG 2.2 tags. It is an axe-core rule subset, not a WCAG conformance test. |
| “Color contrast” | The standalone checker works. **Automated contrast detection from scans does not work in jsdom** — it lands in `incomplete`. |
| “Accessibility score /100” | Ad-hoc penalty: `100 − (critical×10 + serious×5 + moderate×2 + minor×1)`, using **element counts**, not rules, not normalized by page size. Not comparable across pages. |
| “Scan History / View” | Only a compact summary is stored. “View” shows an `alert()`; full results cannot be restored after reload. |
| “Before & After comparison” | Compares summary counts only. The per-issue data stored in history is **never used** for a real diff. |
| “Form Checker” | Counts forms and filters form-related axe violations. It does **not** list individual fields, labels, or associations. |
| “Keyboard Checklist” | Good manual checklist, but results are global (not per site/scan), and there is no explicit “Not Tested” button. |
| “Alt-Text Analyzer” | Only `<img>` elements. No background images, SVG, `<object>`, `<area>`, or `<input type="image">`; no previews or status filters. |
| “Heading Structure” | Outline is useful, but includes hidden/`aria-hidden` headings, and the skip warning text is wrong (see H8). |
| “Scan any website” | Single page only, no crawl, no auth, no SPA wait, no iframes/shadow DOM, and some sites block the user agent. |

### 3.4 Feature inventory (12 pages)

| # | Page | What it does | Status |
|---|---|---|---|
| 1 | Dashboard | Hero scan, feature cards, last scan summary, “How it works”, limitation banner | Working |
| 2 | Scan Website | URL form, staged loading UI, score ring, summary cards, doughnut chart, pass stats, quick tool links | Working, but result focus/announcement issues |
| 3 | Issue Explorer | Search, severity filter, sort, expandable issue cards, affected HTML, fix suggestion, “Mark as Reviewed” | Working; focus/state bugs |
| 4 | Smart Fix Assistant | Why/who/before/after/explanation/copy for 12 common rules | Working; fallback is generic for other rules |
| 5 | Colour Contrast | Hex/RGB inputs, pickers, live preview, AA/AAA pass/fail | Working for solid colours; no alpha/HSL/named colours |
| 6 | Alt-Text Analyzer | Image list with has-alt/empty/missing status, summary cards | Working; limited element coverage |
| 7 | Keyboard Checklist | 12 manual checks, Pass/Fail/N/A, notes, localStorage, progress | Working; not scoped per site |
| 8 | Heading Structure | H1–H6 outline, H1 count, skip detection | Working; message bug, hidden headings included |
| 9 | Form Checker | Form-related violations + form count | Partial / overpromises |
| 10 | Scan History | Last 20 scans, search, view, delete, clear | Partial; “View” is an alert |
| 11 | Before & After | Pick two history entries, compare score/issues/critical/serious | Partial; summary only |
| 12 | Learning Hub | 8 static lessons in accordions | Working |

Plus: dark/light theme, print/PDF report, skip link, responsive sidebar, localStorage persistence.

---

## 4. Architecture and data flow

```
Browser
  │  POST /api/analyze { url }
  ▼
Express (server.js)
  │  helmet, cors, rate-limit, JSON body limit
  │  URL syntax + hostname blocklist  ← weak SSRF check
  ▼
analyzer.js
  │  axios GET (15 s timeout, 5 MB cap, 5 redirects)  ← redirect target not re-checked
  │  content-type check
  ├── runAxe(html, url)
  │     JSDOM(html, { runScripts: 'dangerously', resources: 'usable' })
  │     wait 400 ms (arbitrary)
  │     eval(axe.source)
  │     axe.run(document, { runOnly: WCAG tags })
  │     window.close() only on success
  └── extractPageData(html, url)
        second JSDOM parse (scripts not run)
        images, headings, form count
  ▼
JSON response
  │  url, scannedAt, durationMs, totalIssues, totalViolations,
  │  severityCounts, categories, issues[], passes, incomplete,
  │  images[], headings[], formCount
  ▼
Frontend (app.js)
  │  currentScan / allIssues globals
  │  calcScore() (client-side, ad-hoc)
  │  localStorage history (compact issues only)
  │  render dashboard, tools, PDF window
  ▼
Browser localStorage / sessionStorage
```

**Key architectural fact:** analysis runs **inside the API process, on the main event loop**, with no queue, no worker, no hard kill, and no global concurrency cap. That is the root cause of the availability failure.

---

## 5. Current API contract

### Request

```http
POST /api/analyze
Content-Type: application/json

{ "url": "https://example.com" }
```

### Response (shape)

```json
{
  "url": "https://example.com",
  "scannedAt": "2026-11-23T04:58:00.000Z",
  "durationMs": 1180,
  "totalIssues": 7,
  "totalViolations": 1,
  "severityCounts": { "critical": 0, "serious": 0, "moderate": 7, "minor": 0 },
  "categories": { "wcag2a": 7, "best-practice": 7 },
  "issues": [
    {
      "id": "region",
      "name": "All page content should be contained by landmarks",
      "description": "...",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.14/region",
      "tags": ["best-practice"],
      "severity": "moderate",
      "severityLabel": "Moderate",
      "affectedElements": [
        { "html": "<div>...</div>", "target": ["body > div"], "failureSummary": "..." }
      ],
      "affectedCount": 7,
      "suggestion": "Review the axe-core docs for \"region\" ..."
    }
  ],
  "passes": 9,
  "incomplete": 4,
  "images": [],
  "headings": [],
  "formCount": 0
}
```

### Gaps in the current contract

- No **score** from the server (client computes it independently).
- No **incomplete/needs-review details** (only a count).
- No **pass details** (only a count).
- No **inapplicable** results.
- No **engine/version/config** metadata (which axe version, which tags, which viewport).
- No **job ID**, progress, cancellation, or async model.
- No **error codes** (only free-text messages; raw errors can leak).
- No **versioning** (`/api/v1`).
- No **rate-limit metadata** in a documented form.
- `categories` is computed but never used by the UI.
- `target` selectors are returned but never shown.
- `images`/`headings` are unbounded.

---

## 6. Verification log (what I actually ran)

### 6.1 Happy path — `https://example.com`

```
HTTP 200 in 1.2 s
totalIssues=7  totalViolations=1  passes=9  incomplete=4
severityCounts={"critical":0,"serious":0,"moderate":7,"minor":0}
issueIds=region
images=0  headings=0  forms=0
```

The scan works. Note that example.com has an `<h1>` and other content, yet `headings=0` because the page has no `<h1>`–`<h6>` in its markup; this is correct for that page.

### 6.2 The server-killing scan — `https://www.wikipedia.org`

| Observation | Value |
|---|---|
| Client request | Timed out after **60 s** |
| Server responsiveness after timeout | **Still unresponsive** after 90+ s |
| Node CPU | **278 s → 370 s** while stuck |
| Node RSS | **183 MB → 237 MB** while stuck |
| Recovery | Process had to be killed; restarted as PID 27868; health check `HTTP 200` |

**Root cause:** `JSDOM` is created with `runScripts: 'dangerously'` and `resources: 'usable'` (`backend/analyzer.js:64-69`). Wikipedia’s scripts and subresources load and execute **in the main Node process**, with no timeout and no kill switch. The 15 s axios timeout only covers the initial HTML fetch. The `400 ms` wait is not a load-event wait and does not bound anything.

This is a **single-request denial of service**: any user can take the whole app down by submitting a JavaScript-heavy URL.

### 6.3 SSRF matrix (live tests against the running server)

| Payload | Expected | Actual | Verdict |
|---|---|---|---|
| `http://127.0.0.1:3000/` | 403 | **403** | ✅ blocked |
| `http://192.168.1.1/` | 403 | **403** | ✅ blocked |
| `http://169.254.169.254/` | 403 | **403** | ✅ blocked |
| `http://[::1]:9/` | 403 | **502** (connection refused) | ❌ **filter bypassed** |
| `http://127.0.0.2:9/` | 403 | **502** | ❌ **filter bypassed** |
| `http://10.example.com/` | allowed (public DNS name) | **403** | ❌ **false positive** |
| `http://172.17.0.1/` | 403 | static analysis: **allowed** | ❌ bypass |
| `http://172.31.255.1/` | 403 | static analysis: **allowed** | ❌ bypass |
| `http://[::ffff:127.0.0.1]/` | 403 | normalizes to `[::ffff:7f00:1]`; **allowed** | ❌ bypass |
| `http://metadata.google.internal/` | 403 | **allowed** | ❌ bypass |
| DNS name resolving to `127.0.0.1` | 403 | **allowed** (no DNS check) | ❌ rebinding |
| Public URL redirecting to `127.0.0.1` | 403 | **allowed** (axios follows 5 redirects) | ❌ redirect bypass |
| Public HTML with `<img src="http://169.254.169.254/...">` | blocked | **jsdom fetches it** | ❌ subresource bypass |

**Why it fails:** `server.js:68-73` checks `hostname` strings against a short prefix list. IPv6 hostnames include brackets (`[::1]`), `127.0.0.0/8` is larger than one address, only `172.16.` is blocked (not `172.17.`–`172.31.`), and DNS/redirects/subresources are never validated. The same check also blocks legitimate domains such as `10.example.com`.

### 6.4 jsdom behaviour probe

A controlled local fixture with an inline script, an external script, a low-contrast paragraph, and an image was parsed with the same jsdom options as the app:

| Probe | Result |
|---|---|
| Inline `<script>` executed | **true** (`document.title` changed) |
| External subresource fetched by jsdom | **true** (local server hit count > 0) |
| External script executed | **true** |
| axe `color-contrast` for `#aaaaaa` on `#ffffff` | **`incomplete`**, not `violations` |
| Violations found | `image-alt`, `region` |
| Incomplete found | `color-contrast`, `landmark-one-main`, `page-has-heading-one` |

This confirms three things:

1. The README’s claim that “jsdom does not run the page’s scripts” is **false**.
2. jsdom’s subresource loading is an **SSRF amplification vector** independent of the initial URL check.
3. **Automated contrast checking does not work** in this architecture. jsdom has no real layout/paint pipeline; axe cannot compute rendered colours, so failing contrast becomes `incomplete`. The standalone checker still works, but the scan report will not catch contrast violations.

### 6.5 Headers and routing

| Check | Result |
|---|---|
| `GET /` | `200 text/html` |
| `GET /api/analyze` (wrong method) | **`200 text/html`** — SPA fallback, should be 404/405 |
| `GET /does-not-exist.png` | **`200 text/html`** — missing assets return the SPA |
| `Content-Security-Policy` | **absent** (`contentSecurityPolicy: false`) |
| HSTS | present |
| `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, COOP/CORP | present |
| Static caching | `Cache-Control: public, max-age=0` |
| Compression | absent |

### 6.6 Dependency audit

```
2 moderate, 0 high, 0 critical
nodemon → minimatch (dev-only, fix available)
prod dependencies: 139; dev: 29; total: 167
```

### 6.7 The tool’s own contrast (WCAG ratios)

Measured with the WCAG relative-luminance formula:

| Element | Colours | Ratio | Verdict |
|---|---|---:|---|
| Sidebar section labels (`.nav-section-label`) | `#475569` on `#0f172a` | **2.36:1** | ❌ fails AA (small bold text needs 4.5) |
| Moderate severity badge | `#ca8a04` on `#fefce8` | **2.84:1** | ❌ fails |
| Serious severity badge | `#ea580c` on `#fff7ed` | **3.35:1** | ❌ fails for small text |
| Critical severity badge | `#dc2626` on `#fef2f2` | **4.41:1** | ❌ just below 4.5 |
| Success text on success background (`.fix-suggestion`, `.chk-btn.pass`, `.step.done`) | `#16a34a` on `#f0fdf4` | **3.15:1** | ❌ fails for small text |
| Success text on white (`.delta-better`) | `#16a34a` on `#ffffff` | **3.30:1** | ❌ fails for small text |
| Page subtitle on page background | `#64748b` on `#f1f5f9` | **4.34:1** | ❌ slightly below 4.5 |
| Primary link | `#4f46e5` on `#ffffff` | 6.29:1 | ✅ |
| Sidebar body text | `#cbd5e1` on `#0f172a` | 12.02:1 | ✅ |
| Dark-mode muted text | `#94a3b8` on `#1e293b` | 5.71:1 | ✅ |

**Implication:** an accessibility analyzer that fails its own contrast checks will lose credibility immediately. These are token-level fixes, not redesigns.

---

## 7. Weakness audit

Findings are grouped by severity. Each has an ID for roadmap cross-reference.

### 7.1 Critical (P0) — fix before exposing the app to anyone

#### C1. Untrusted JavaScript executes in the main server process

- **Where:** `backend/analyzer.js:64-80`
- **What:** `runScripts: 'dangerously'`, `resources: 'usable'`, `window.eval(axe.source)`, fixed 400 ms wait, `window.close()` only after success.
- **Impact:** a target page can run CPU-heavy/infinite scripts, allocate memory, issue network requests, and keep the event loop blocked. Confirmed full-server hang on `wikipedia.org`.
- **Secondary impact:** jsdom is **not a security sandbox**. Running attacker-controlled JS in the API process is an unacceptable trust boundary even if the page is “just a website”.
- **Fix:** do not execute page scripts for analysis. If SPA rendering is required, use **Playwright/Chromium** in a separate worker process with a hard timeout, blocked non-document requests, and a memory cap. Never run it on the API event loop.

#### C2. SSRF filter is bypassable and over-broad

- **Where:** `server.js:67-76`
- **What:** string prefix blocklist.
- **Impact:** internal network scanning, cloud metadata access, localhost services, DNS rebinding, redirect-based bypass, and jsdom subresource bypass.
- **Fix:** resolve DNS (`dns.promises.lookup({ all: true })`), classify every address with a real IP library (`ipaddr.js`), pin the resolved IP for the request, re-validate on every redirect, and block all subresource loading. Add an egress firewall as defence in depth.

#### C3. No hard timeout, queue, or concurrency isolation

- **Where:** `backend/analyzer.js:10, 39-80`; `server.js:28-33`
- **What:** axios timeout is fetch-only; jsdom has no timeout; analysis runs on the main thread; rate limiting is per-IP only.
- **Impact:** one slow/malicious page blocks the server; many requests exhaust memory; the app has no load shedding.
- **Fix:** run analysis in a **child process/worker** with `Promise.race` + forced kill (e.g., 20 s); add a bounded queue (e.g., 2 concurrent, 50 waiting); add a global rate limit and memory guard; return `503` when saturated.

#### C4. Internal error details leak to clients

- **Where:** `server.js:91`
- **What:** `res.status(500).json({ error: 'Analysis failed: ' + err.message })`.
- **Impact:** reveals internal hostnames, file paths, library messages, and stack-adjacent details; aids attackers.
- **Fix:** map known errors to safe messages, log the internal detail server-side with a request ID, return a generic message + correlation ID.

#### C5. CSP disabled and CDN assets have no SRI

- **Where:** `server.js:17-19`; `public/index.html:7-9, 704`
- **What:** `contentSecurityPolicy: false`; Bootstrap/Chart.js/icons loaded from `cdn.jsdelivr.net` without `integrity`.
- **Impact:** no defence-in-depth against XSS; a compromised CDN or MITM can execute arbitrary script in users’ browsers.
- **Fix:** self-host the assets (best for a mini-project), or add SRI hashes and a strict CSP. Note that inline `style="..."` attributes require `style-src 'unsafe-inline'` unless refactored; the app has **no inline `<script>` blocks**, so `script-src` can be strict.

### 7.2 High (P1) — correctness, trust, and accessibility

#### H1. Automated contrast checking is effectively broken

- **Where:** `backend/analyzer.js:64-80`
- **Evidence:** controlled probe put failing contrast in `incomplete`, not `violations`.
- **Impact:** the report can say “no contrast issues” when text is unreadable; the “WCAG 2.1 AA” claim is overstated.
- **Fix:** use a real browser engine (Playwright + Chromium) for rendered contrast, or remove contrast from the automated claim and direct users to the standalone checker. In the UI, surface `incomplete` items as “needs manual review”, not silence.

#### H2. The score is ad-hoc, element-based, and not comparable

- **Where:** `app.js:236-241`; counts from `backend/analyzer.js:157-161`; UI `index.html:323-352`
- **What:** `100 − (critical×10 + serious×5 + moderate×2 + minor×1)`, using **affected element counts**, capped at 0.
- **Impact:** a large page with 20 minor issues can score 0 while a small page with one serious issue scores 95; scores are not comparable across pages or runs. The top summary cards also **omit Minor**, so the visible numbers don’t add up to Total.
- **Fix:** define and version a transparent score (per-rule weighted, normalized by rules evaluated and page size); compute it server-side; show “rules failed” and “elements affected” as separate metrics; add the Minor card; link to the formula.

#### H3. History cannot restore a report; comparison is summary-only

- **Where:** `app.js:252-268` (compact history), `1234-1276` (View is `alert`), `1281-1353` (compare)
- **What:** full results live only in the `currentScan` global. On reload, history remains but tools show “no scan”. “View” alerts a summary. Compare uses only score/total/severity; the stored per-issue array is unused.
- **Impact:** the “History” and “Before & After” features overpromise; users cannot revisit or diff actual findings.
- **Fix:** persist full results in IndexedDB (or a server DB) and restore `currentScan`; implement issue-level diff (fixed / new / persisting) using rule id + target; show WCAG tag deltas.

#### H4. Collapsed accordion content remains keyboard-focusable

- **Where:** `style.css:444-448` (issue cards), `494-495` (fix cards), `632-636` (lessons)
- **What:** `max-height: 0; overflow: hidden` hides content visually, but links/buttons inside remain in the tab order.
- **Impact:** keyboard users tab into invisible controls; screen-reader users may encounter hidden content; WCAG 2.4.3 / 2.4.7 concerns.
- **Fix:** use the `hidden` attribute or `inert` on collapsed panels, and toggle it with `aria-expanded`; or use native `<details>/<summary>`.

#### H5. Dynamic duplicate IDs across pages

- **Where:** `app.js:821, 828` (`id="ib-${idx}"`), `1227` (forms page reuses `buildIssueCard`)
- **What:** the Issue Explorer and Form Checker both render cards starting at `idx=0` into the same document.
- **Impact:** duplicate IDs (`ib-0`, `ib-1`, …), ambiguous `aria-controls`, invalid HTML, and unreliable assistive-technology relationships.
- **Fix:** prefix IDs per page (`issues-ib-${idx}`, `forms-ib-${idx}`) or use a global counter/UUID.

#### H6. Focus and announcements are lost on re-render

- **Where:** `app.js:856-865` (mark reviewed re-renders all issues), `1111-1122` (keyboard checklist re-renders), `465-507` (results render)
- **What:** full `innerHTML` replacement destroys the focused element; “Mark as Reviewed” collapses the card and loses position; scan results appear without moving focus or announcing the score.
- **Impact:** keyboard and screen-reader users lose context; a core workflow is frustrating.
- **Fix:** update only the affected card/button; restore focus explicitly; focus the results heading (`tabindex="-1"`) or announce via a polite live region; keep expanded state in a `Set`.

#### H7. Failed scans leave stale results on screen

- **Where:** `app.js:393-435`
- **What:** `doScan` shows loading but does not hide/mark the previous `#scanResults`; on error, old results remain visible.
- **Impact:** users may attribute old findings to the new URL.
- **Fix:** hide results (or show a “stale” banner) when a scan starts; clear on failure; keep the previous scan only in history.

#### H8. Heading-skip warning reports the wrong level

- **Where:** `app.js:1179`
- **What:** `skip from H${h.level>1?h.level-1:1}`. For a jump from H2 to H4 it says “skip from H3”; it should reference the previous heading level (H2).
- **Impact:** misleading guidance in an educational tool.
- **Fix:** use `prevLevel` in the message (and count the actual gap).

#### H9. Zero-issue scans show “No issues match your filter”

- **Where:** `app.js:747-799`
- **What:** with a successful scan and zero issues, `applyIssueFilters` shows `#noFilteredIssues` (“No issues match your filter”) instead of a success state.
- **Impact:** the best possible result looks like a filtering error.
- **Fix:** dedicated “No violations detected” success state with next steps (manual testing, other pages, contrast).

#### H10. The tool’s own UI fails contrast and has partial dark mode

- **Where:** `style.css:119-123, 432-435, 563-565, 599-601`; `app.js:335-350`
- **What:** measured failures in section labels (2.36:1), moderate badge (2.84:1), success text (3.15–3.30:1), page subtitle (4.34:1); several light-mode chips are not overridden in dark mode; theme is applied only after `app.js` loads, causing a flash.
- **Impact:** credibility and real accessibility harm.
- **Fix:** audit all tokens against 4.5:1 (small text) / 3:1 (large text and UI); darken success/moderate/serious text; add dark variants for every chip; apply the saved theme in a tiny inline `<head>` script (or server-rendered `data-theme`); respect `prefers-color-scheme`.

#### H11. Last-scan buttons are broken after a reload

- **Where:** `app.js:1381-1398`
- **What:** after reload, `scanHistory` restores the last-scan card, but `currentScan` is `null`; “View Results” navigates to an empty scan page, and “Re-scan” returns silently.
- **Impact:** two prominent buttons appear functional but do nothing useful.
- **Fix:** restore the full last scan from storage, or disable/relabel the buttons when no in-memory scan exists.

### 7.3 Medium (P2) — reliability, maintainability, and UX

| ID | Finding | Where | Impact / fix |
|---|---|---|---|
| M1 | Fixed `max-height` clips long accordion content (1,500/2,000 px) | `style.css:448, 494, 636` | Long issue bodies/lessons get cut off; use `grid-template-rows`/`hidden`/native `<details>` |
| M2 | PDF print can fire twice | `app.js:732-741` | `onload` print + 1.2 s fallback both call `win.print()`; guard with a `printed` flag |
| M3 | Chart.js CDN failure breaks result rendering | `app.js:509-540`; `index.html:9` | `new Chart` throws inside the scan `try`, showing a scan error even though the scan succeeded; self-host or lazy-load with a fallback |
| M4 | Invalid colour input produces `NaN` | `app.js:947-960` | `#zzzzzz` → `NaN` ratio and all-fail badges; validate and show an inline error |
| M5 | Corrupt `localStorage` can break the app | `app.js:246-251, 1086-1088` | `JSON.parse` result is not checked for shape; guard with schema validation and try/catch around consumers |
| M6 | Hardcoded `en-IN` locale | `app.js:220-223` | Dates are inconsistent for international users; use `undefined`/browser locale or a setting |
| M7 | No charset detection | `backend/analyzer.js:39-57` | Non-UTF-8 pages garble alt text/headings; respect `Content-Type` charset and `<meta charset>` |
| M8 | Double HTML parse and unclosed JSDOM | `backend/analyzer.js:64-88` | `extractPageData` parses the same HTML again and never calls `window.close()`; CPU/memory waste |
| M9 | Unbounded `images`/`headings` payload | `backend/analyzer.js:92-119` | Huge pages produce huge JSON; cap counts and truncate fields |
| M10 | Dead data | `backend/analyzer.js:163-169`; `app.js:263` | `categories`, `target` selectors, and stored history issues are computed/stored but never used |
| M11 | Duplicated fix content | `backend/analyzer.js:15-36` vs `app.js:13-91` | Two sources of truth drift; serve guidance from one place |
| M12 | Monolithic files and global state | `app.js` (1,406 lines), `index.html` (707), `style.css` (687) | Hard to test/refactor; split into modules/components and a small store |
| M13 | No tests, lint, format, or types | repo root | Regressions are inevitable; add Vitest/Jest, ESLint, Prettier, JSDoc/TS |
| M14 | `app.get('*')` masks 404s and API method errors | `server.js:96-98` | `GET /api/analyze` returns HTML 200; missing assets return HTML 200; return JSON 404/405 for API and HTML 404 for pages |
| M15 | CORS is hardcoded and unnecessary for same-origin | `server.js:21-25` | Deployment on another port/domain breaks; configure via env or remove |
| M16 | No `trust proxy` | `server.js:28-33` | Behind a reverse proxy, all users share the proxy IP and the 20-request limit becomes global |
| M17 | In-memory rate limit | `server.js:28-33` | Resets on restart; not shared across instances; use Redis in production |
| M18 | No compression, request logging, health check, or graceful shutdown | `server.js` | Operational blindness; add `compression`, `pino`/`morgan`, `/healthz`, SIGTERM handling |
| M19 | Node engine mismatch | `package.json:22-24` | Claims `>=16`, but jsdom needs `>=18`; Node 16 is EOL; set `>=20` |
| M20 | Floating ranges and four majors behind | `package.json` | Installed versions drift; pin or use `npm ci`; plan upgrades |
| M21 | No `.gitignore`, `LICENSE`, `.env.example`, Docker, CI | repo root | `node_modules` can be committed; no reproducible deploy; MIT declared but no license file |
| M22 | Form Checker overpromises | `index.html:607`; `app.js:1193-1229` | It does not list fields/labels/associations; either extract them server-side or rename the page |
| M23 | Alt-text coverage is `<img>`-only | `backend/analyzer.js:92-105` | Misses CSS backgrounds, SVG, `<object>`, `<area>`, `<input type="image">`; add coverage or document |
| M24 | Keyboard checklist is global, not per site | `app.js:1086-1138` | Results from one site appear on another; scope by scan/URL; add explicit “Not Tested”; debounce notes |
| M25 | Heading outline includes hidden headings | `backend/analyzer.js:108-114` | `display:none`, `aria-hidden`, and `hidden` headings appear; filter them; add landmark outline |
| M26 | History cap of 20 is silent | `app.js:266` | Older scans disappear without warning; show the cap, add export/import |
| M27 | No retry/backoff, robots.txt check, auth, or SPA wait | `backend/analyzer.js` | Transient failures are permanent; ethical/legal risk; protected pages unsupported; SPAs incomplete |
| M28 | `alert()`/`confirm()` for core flows | `app.js:1268, 1275, 1134, 724` | Poor UX, not styleable, weak for assistive tech; replace with dialogs |
| M29 | Chart legend is `aria-hidden` | `index.html:360` | Screen-reader users miss the breakdown; keep a text summary or accessible table |
| M30 | Non-interactive summary cards are focusable | `index.html:325-350` | `tabindex="0"` on static cards adds empty tab stops; remove unless they become buttons |

### 7.4 Low (P3) — polish and hygiene

- No favicon (404 noise), no meta description/Open Graph tags, no `manifest.webmanifest`.
- Bootstrap JS bundle is loaded but unused; Chart.js (~200 KB) is used for one doughnut.
- `aria-expanded` on the mobile menu button is not reset when navigating via the sidebar.
- Sidebar has no Escape-to-close, no focus trap, and no focus move into the panel.
- Copy button has no clipboard fallback for insecure contexts.
- Filter buttons lack `aria-pressed`; theme toggle lacks `aria-pressed`/state label.
- URL inputs don’t set `aria-invalid` when validation fails.
- `failureSummary` newlines collapse in HTML (needs `white-space: pre-line`).
- `scroll-behavior: smooth` and animations ignore `prefers-reduced-motion`.
- `overflow-x: hidden` on `body` can clip focus outlines/zoomed content.
- Dark mode doesn’t set `color-scheme`, so native controls can render light.
- Theme toggle’s `aria-label` is static (“Toggle dark mode”) even in dark mode.
- PDF report is not a tagged/accessible PDF; it’s a print window.
- `role="list"` on `<ul>` is redundant; `role="banner"`/`contentinfo` on native elements are redundant.
- No `aria-busy` on the results region during scanning.
- No `target` selector display or copy button on affected elements.
- No “expand all / collapse all” in the issue explorer.
- Search only covers name/description, not rule id, tags, or selector.
- No URL/hash routing: browser Back/Forward doesn’t work, pages aren’t deep-linkable, and `document.title` never changes.
- No service worker/PWA/offline mode.
- No 200% zoom / 320 px reflow test; no touch-target audit.

### 7.5 Documentation weaknesses

| ID | Issue |
|---|---|
| D1 | README says “jsdom does not run the page’s scripts” (`README.md:114-115`), but the code runs them with `runScripts: 'dangerously'`. This is factually wrong and hides the biggest risk. |
| D2 | Feature list omits 8 of the 12 pages (contrast, alt-text, keyboard, headings, forms, history, compare, learning). |
| D3 | “WCAG 2.1 AA” is inaccurate: the scan includes `best-practice` and does not include WCAG 2.2. |
| D4 | Dependency versions in the README are stale compared with installed versions. |
| D5 | No API documentation, response schema, error codes, or example payload. |
| D6 | No environment-variable documentation (`PORT`, CORS origins, rate limits, timeouts). |
| D7 | No security limitations section (SSRF/DoS surface), no test instructions, no deployment guide. |
| D8 | No `LICENSE` file, changelog, contributing guide, or security policy despite MIT in `package.json`. |
| D9 | No statement that scans are single-page, iframe/shadow-DOM-blind, auth-less, and contrast-incomplete in jsdom. |

### 7.6 Accessibility of the tool itself

**Strengths:** skip link; `lang="en"`; labelled inputs; `aria-describedby` on URL fields; `role="alert"` errors; `aria-live` on result counts and contrast results; `aria-expanded` on accordions; `aria-current` on nav; visible focus on many controls; icon-only buttons have labels; semantic landmarks; responsive layout.

**Weaknesses:** measured contrast failures (H10); focusable collapsed content (H4); focus loss on re-render (H6); results not announced (H6); non-interactive cards in the tab order (M30); filter state not exposed (`aria-pressed`); no reduced-motion support; sidebar focus management; dark-mode inconsistencies; no 200% zoom/reflow verification; PDF not accessible.

---

## 8. Security hardening plan

### 8.1 Threat model (realistic for this app)

| Threat | Current exposure | Priority |
|---|---|---|
| SSRF to cloud metadata / internal services | High (bypassable blocklist, subresources, redirects) | P0 |
| DoS via malicious/slow/JS-heavy pages | **Confirmed** (single request hangs server) | P0 |
| RCE via jsdom/script sandbox escape | Low-to-medium (jsdom is not a sandbox; historical escapes exist) | P0 |
| Supply-chain via CDN | Medium (no SRI, CSP off) | P1 |
| Information disclosure via error messages | Medium | P1 |
| Abuse of public scan endpoint | Medium (per-IP limit only, no auth/global cap) | P1 |
| XSS in the frontend | Low (most dynamic HTML is escaped; static lesson HTML is trusted) | P2 |
| CSRF | Low (JSON POST + CORS; no cookies/auth) | P3 |
| Privacy (URLs may contain tokens) | Medium (logged in full) | P2 |

### 8.2 Safe URL fetching recipe

```js
// Pseudocode — add ipaddr.js and use a custom lookup/agent.
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('bad-protocol');
  if (u.username || u.password) throw new Error('credentials-not-allowed');
  if (u.port && !['80', '443', ''].includes(u.port)) throw new Error('port-not-allowed');

  const records = await dns.lookup(u.hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error('dns-failed');

  for (const { address } of records) {
    const parsed = ipaddr.parse(address);
    const range = parsed.range(); // 'unicast' is the only public range
    if (range !== 'unicast') throw new Error('private-address-blocked');
  }
  return { url: u, addresses: records.map(r => r.address) };
}
```

Additional requirements:

- **Pin the resolved IP** for the actual request (custom `lookup` in the HTTP agent) to defeat DNS rebinding.
- **Re-validate every redirect** (`beforeRedirect` hook or manual redirect loop). Reject non-HTTP(S) schemes and private targets.
- **Disable subresource loading** in the analyzer. If a real browser is used, route-block everything except the top-level document.
- **Block ports** other than 80/443 (and optionally 8080/8443 if needed).
- **Reject credentials in URLs** (`user:pass@host`).
- **Egress firewall** (defence in depth): deny RFC1918, loopback, link-local, CGNAT, multicast, and metadata ranges at the network layer.
- **Do not follow redirects to a different host** unless explicitly allowed.

### 8.3 Safe analysis isolation

Recommended minimum for this project:

```js
// Pseudocode: run analysis in a child process with a hard kill.
const { fork } = require('child_process');

function analyzeInChild(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = fork(require.resolve('./backend/analyze-worker.js'), [url], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' }
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('analysis-timeout'), { status: 504 }));
    }, timeoutMs);
    child.once('message', msg => { clearTimeout(timer); child.kill(); resolve(msg); });
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('exit', code => {
      if (code !== 0) { clearTimeout(timer); reject(new Error('analysis-crashed')); }
    });
  });
}
```

Also add:

- A **bounded queue** (e.g., `p-limit`, BullMQ, or a simple in-memory queue) with a max of 2 concurrent analyses.
- A **global request cap** and a `503` when saturated.
- **Per-scan memory cap** (`--max-old-space-size`).
- **No page scripts/resources** unless a real browser is used; then use Playwright with a context per scan and a hard timeout.
- **Clean up** all JSDOM windows in `finally`.

### 8.4 Headers, CSP, and SRI

If assets stay on the CDN:

```js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
```

Better: **self-host** Bootstrap, Bootstrap Icons, and Chart.js. That removes the CDN dependency, enables a strict CSP without third-party origins, and makes the app work offline. Add SRI if any CDN remains:

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
```

### 8.5 Rate limiting and deployment

- Add `app.set('trust proxy', 1)` only when behind a trusted proxy (otherwise spoofable).
- Use a shared store (Redis) for rate limits in multi-instance deployments.
- Add a **global** limiter in addition to the per-IP limiter.
- Return `Retry-After` and a JSON body on 429.
- Consider API keys/quotas before exposing the endpoint publicly.
- Add a **queue depth** metric and a `503` when saturated.
- Add `/healthz` (liveness) and `/readyz` (readiness).

### 8.6 Error handling

Map errors to stable codes and safe messages:

| Condition | Status | Client message |
|---|---:|---|
| Missing/invalid `url` | 400 | “Please provide a valid http(s) URL.” |
| Private/internal target | 403 | “Scanning private or internal addresses is not allowed.” |
| DNS failure | 502 | “Could not resolve that website.” |
| Connection refused | 502 | “Could not connect to that website.” |
| Timeout | 504 | “The scan timed out. Try a lighter page or try again later.” |
| Non-HTML response | 422 | “That URL did not return an HTML page.” |
| Too large | 413 | “The page is too large to scan (limit 5 MB).” |
| Rate limited | 429 | “Too many scans. Please wait and try again.” |
| Analysis crashed | 500 | “The scan failed unexpectedly. Reference: <requestId>.” |
| Queue full | 503 | “The scanner is busy. Please try again shortly.” |

Log the internal error and request ID server-side; never concatenate `err.message` into the response.

---

## 9. Improvement roadmap

### 9.1 P0 — stop the bleeding (1–3 days)

| # | Task | Why | Effort |
|---|---|---|---|
| 1 | Disable `runScripts` and `resources` in jsdom | Removes the confirmed DoS and subresource SSRF | S |
| 2 | Add a hard analysis timeout in a child process/worker with forced kill | Guarantees the server stays responsive | M |
| 3 | Replace the hostname blocklist with DNS + IP-range validation + redirect checks | Closes SSRF bypasses | M |
| 4 | Sanitize 500 responses and add request IDs | Stops information leakage | S |
| 5 | Add regression tests for SSRF, timeout, and non-HTML responses | Prevents re-introduction | M |
| 6 | Remove `app.get('*')` fallback for API/missing assets | Correct 404/405 semantics | S |

**Exit criteria:** `[::1]`, `127.0.0.2`, `172.17.0.1`, metadata hostnames, redirect-to-private, and a JS-heavy page all fail safely within 20 s without blocking other requests.

### 9.2 P1 — correctness and trust (1–2 weeks)

| # | Task | Why | Effort |
|---|---|---|---|
| 7 | Server-side, versioned, normalized score; separate “rules failed” vs “elements affected” | Comparable, honest results | M |
| 8 | Add Minor card; make Total = sum of severities; show the formula | Removes visible inconsistency | S |
| 9 | Surface `incomplete` / “needs review” details with rule names and nodes | Users can act on uncertainty | M |
| 10 | Persist full scans (IndexedDB) and restore on View | Makes History real | M |
| 11 | Issue-level Before/After diff (fixed/new/persisting) | Delivers the promised feature | M |
| 12 | Fix accordions: `hidden`/`inert`, preserve focus, announce results | Core keyboard/SR usability | M |
| 13 | Fix duplicate IDs, heading-skip message, zero-issue state, stale results | Correctness and polish | S |
| 14 | Fix self-contrast tokens and dark-mode variants | Credibility | S |
| 15 | Add `prefers-reduced-motion` and remove non-interactive tab stops | WCAG basics | S |
| 16 | Self-host CDN assets or add SRI + CSP | Supply-chain safety | M |

### 9.3 P2 — reliability and maintainability (2–4 weeks)

| # | Task | Why | Effort |
|---|---|---|---|
| 17 | Split `app.js` into modules (`scan`, `issues`, `history`, `contrast`, `ui`) | Testability and clarity | M |
| 18 | Split `index.html` into templates/components | Maintainability | M |
| 19 | Add Vitest/Jest + Playwright E2E + axe tests on own UI | Regression safety | L |
| 20 | Add ESLint/Prettier/TypeScript (or JSDoc types) | Quality gate | M |
| 21 | Add env config (`PORT`, origins, timeouts, limits, Redis) | Deployability | S |
| 22 | Add Docker, CI, health checks, graceful shutdown, structured logs | Production baseline | M |
| 23 | Add charset detection and cap images/headings | Correctness and payload control | S |
| 24 | Consolidate fix guidance into one source | Removes drift | S |
| 25 | Upgrade to Express 5, jsdom 31, helmet 8, rate-limit 8 (with tests) | Security/maintenance | M |
| 26 | Add `.gitignore`, `LICENSE`, `.env.example`, `SECURITY.md` | Repo hygiene | S |

### 9.4 P3 — polish (backlog)

- Favicon, meta/OG tags, manifest, service worker.
- Replace `alert`/`confirm` with accessible dialogs.
- Add URL/hash routing, browser history, and per-page `document.title`.
- Add “expand all/collapse all”, search by rule id/tag/selector, copy selector.
- Add print-friendly full report and accessible PDF.
- Add 200% zoom, 320 px reflow, and touch-target checks.
- Add `aria-pressed` to filters/theme toggle, `aria-invalid` to inputs, `aria-busy` to results.
- Add clipboard fallback and keyboard shortcuts.
- Add empty/loading/error skeletons for every tool.

### 9.5 Effort/impact summary

| Priority | Items | Expected outcome |
|---|---|---|
| P0 | 6 | Server can no longer be trivially DoS’d or used as an SSRF proxy |
| P1 | 10 | Results become trustworthy, history/comparison become real, UI passes its own accessibility bar |
| P2 | 10 | Codebase becomes testable, deployable, and maintainable |
| P3 | ~15 | Professional polish and broader usability |

---

## 10. Feature roadmap

### 10.1 Quick wins (1–3 days each)

1. **Transparent score** — server-computed, versioned, with an info tooltip and a “how this is calculated” link.
2. **Minor severity card** + “rules failed vs elements affected” labels.
3. **Needs-review panel** — list `incomplete` rules with why they need manual review.
4. **WCAG tag breakdown** — use the already-computed `categories` (A, AA, best-practice, 2.2).
5. **Show selectors** — display `target` next to HTML snippets; add copy buttons.
6. **JSON/CSV export** of the current scan.
7. **Demo scan** — a built-in intentionally broken page so the app works without network.
8. **Restore last scan** after reload (IndexedDB).
9. **Success state** for zero violations.
10. **Auto theme** (`prefers-color-scheme`) + reduced-motion support.
11. **“Re-scan and compare”** — automatically diff the new scan against the previous one for the same URL.
12. **Accessible results announcement** — focus the report heading and announce the score.

### 10.2 Medium (1–2 weeks each)

13. **Real browser engine** — Playwright + Chromium for accurate contrast, CSS, SPAs, and viewport emulation.
14. **Multi-page crawl** — follow same-origin links or `sitemap.xml` with depth/page limits.
15. **Rule/tag selector** — WCAG 2.0/2.1/2.2, A/AA/AAA, best-practice, specific rules.
16. **Paste HTML / upload file** — analyze markup without hosting it.
17. **Authenticated scans** — custom headers/cookies (encrypted, never logged).
18. **Issue-level diff** — fixed/new/persisting, with per-rule and per-severity deltas.
19. **Server-side PDF** — consistent branding, no pop-up, accessible/tagged output.
20. **Shareable report links** — short ID, expiry, optional password.
21. **Scheduled scans + alerts** — daily/weekly, email/Slack/webhook on regressions.
22. **GitHub Action + badge** — fail CI on new violations; embed a live score badge.
23. **API keys + usage dashboard** — quotas, revoke, per-key rate limits.
24. **Public REST API docs** — OpenAPI/Swagger, examples, error codes.
25. **Manual audit workflow** — expand the keyboard checklist into a full WCAG 2.2 AA checklist with evidence/notes.
26. **Landmark/structure analyzer** — header/nav/main/footer/aside outline alongside headings.
27. **Image coverage** — CSS backgrounds, SVG, `<object>`, `<area>`, `<input type="image">`; thumbnails and filters.
28. **Form coverage** — list fields, labels, required/autocomplete/input type, error associations.
29. **Contrast upgrades** — alpha blending, HSL/named colours, suggested nearest AA colour, eyedropper, saved palettes.
30. **History upgrades** — trend chart, grouping by domain, tags/notes, import/export, configurable cap.
31. **Learning hub upgrades** — search, progress, quiz, glossary, links to WCAG success criteria.

### 10.3 Advanced (1–3 months each)

32. **Accounts, teams, workspaces** — Postgres, RBAC, SSO, audit logs.
33. **Queue + worker autoscaling** — BullMQ/Redis, concurrency limits, retries, dead-letter queue.
34. **Historical monitoring** — regression detection, score trends, SLA dashboards.
35. **Multi-engine analysis** — axe-core + IBM Equal Access + HTML_CodeSniffer, merged/deduplicated.
36. **Screen-reader/accessibility-tree snapshot** — show the computed accessible names/roles.
37. **Visual regression** — screenshots per viewport, diff overlays.
38. **AI-assisted fixes** — alt-text suggestions and code patches with human review; never auto-apply.
39. **VPAT/ACR export** — structured conformance report for procurement.
40. **White-label reports** — logo, colours, custom domains.
41. **Browser extension** — scan the current tab.
42. **CMS/WordPress plugin** — scan on publish.
43. **i18n/RTL** — UI and report localization.
44. **PWA/offline** — cache the UI and last reports.
45. **On-prem/Docker distribution** — single-command deploy.
46. **Monitoring/error tracking** — Sentry, OpenTelemetry, uptime checks.
47. **Privacy-friendly analytics** — scan counts, success rate, no URL content.

### 10.4 Feature value/effort matrix

| Feature | User value | Effort | Priority |
|---|---|---|---|
| Fix DoS/SSRF | Critical | M | P0 |
| Transparent score + units | High | S | P0 |
| Needs-review details | High | M | P1 |
| History restore + issue diff | High | M | P1 |
| Playwright contrast/SPA | Very high | L | P1 |
| Multi-page crawl | Very high | L | P2 |
| Server-side PDF + share links | High | M | P2 |
| GitHub Action + badge | High (for devs) | M | P2 |
| Scheduled scans + alerts | High | L | P3 |
| Accounts/teams | Medium | XL | P3 |
| AI alt-text suggestions | Medium | L | P3 |
| Browser extension | Medium | M | P3 |

### 10.5 Deliberately not recommended (scope discipline)

- **Do not claim WCAG certification.** Automated tools cannot certify conformance; keep the disclaimer prominent.
- **Do not auto-apply code fixes.** Suggestions are educational; auto-editing user code is risky.
- **Do not crawl aggressively.** Respect `robots.txt`, rate limits, and site terms; cap pages and concurrency.
- **Do not store sensitive URLs** (tokens, internal hostnames) without consent; redact logs.
- **Do not run untrusted page scripts** just to “support SPAs”; use a real browser in isolation or accept the limitation.

---

## 11. Proposed target architecture

### 11.1 Mini-project version (recommended for now)

Keep it simple, but safe:

```
Express API
  ├── POST /api/v1/scans          → validate URL, enqueue job
  ├── GET  /api/v1/scans/:id      → status/result
  ├── GET  /api/v1/health
  └── static frontend (vanilla JS modules)
        │
        ▼
  In-memory queue (max 2 concurrent)
        │
        ▼
  Child process worker (hard 20 s timeout, 512 MB cap)
        ├── axios fetch (DNS + IP validation, redirect checks, 5 MB cap)
        ├── jsdom WITHOUT scripts/resources  (or Playwright later)
        ├── axe-core
        └── extract page data
        │
        ▼
  Result returned to API; stored in IndexedDB client-side
```

This fixes the critical risks without introducing Redis/Postgres. It is still a mini-project, but a defensible one.

### 11.2 Production version

```
CDN / Static frontend (React/Vite or vanilla)
        │ HTTPS
        ▼
API (Fastify/Express) ── Redis (rate limit, cache, queue)
        │
        ▼
BullMQ queue ── Worker pool (Playwright + axe, isolated containers)
        │                         │
        │                         ├── S3 (HTML snapshots, screenshots, PDFs)
        ▼                         └── Postgres (users, scans, issues, diffs)
Reporting service (PDF/CSV/JSON, share links)
Monitoring (Sentry, OpenTelemetry, uptime)
```

### 11.3 Suggested folder structure

```
backend/
├── config/            env parsing, constants
├── middleware/        security, rate limit, errors, request id
├── routes/            scans, reports, health
├── services/
│   ├── fetcher.js     safe URL fetch (DNS/IP/redirect validation)
│   ├── analyzer.js    axe orchestration
│   ├── extractor.js   images/headings/forms/landmarks
│   ├── scorer.js      versioned score formula
│   └── reporter.js    PDF/CSV/JSON
├── queue/             in-memory or BullMQ
├── workers/           child process/worker entry
└── utils/             ip, html, errors, logger
public/
├── js/
│   ├── modules/       scan, issues, history, contrast, compare, ui
│   └── app.js         bootstrap only
├── css/
└── index.html
tests/
├── unit/
├── integration/
├── e2e/
└── fixtures/
```

### 11.4 Proposed API v1

```http
POST /api/v1/scans
{ "url": "https://example.com", "options": { "tags": ["wcag2a","wcag2aa"], "viewport": "desktop" } }
→ 202 { "id": "scan_...", "status": "queued" }

GET /api/v1/scans/:id
→ 200 { "id", "status": "done", "score": 72, "scoreVersion": "1.0",
        "rules": { "failed": 7, "passed": 42, "incomplete": 4 },
        "elements": { "affected": 23 },
        "issues": [...], "needsReview": [...], "page": {...},
        "engine": { "name": "axe-core", "version": "4.14.1" } }

GET /api/v1/scans/:id/report.pdf
GET /api/v1/scans/:id/export.json
GET /api/v1/scans/:id/export.csv
GET /api/v1/scans/:id/diff/:otherId
GET /api/v1/health
```

### 11.5 Score formula redesign

The current formula is opaque and element-count-based. A better starting point:

```js
// Versioned, per-rule weighted, normalized by rules evaluated.
const WEIGHTS = { critical: 10, serious: 6, moderate: 3, minor: 1 };

function calculateScore(violations, rulesEvaluated) {
  const failedWeight = violations.reduce(
    (sum, v) => sum + (WEIGHTS[v.impact] ?? 1),
    0
  );
  const maxWeight = Math.max(1, rulesEvaluated * WEIGHTS.critical);
  const ratio = Math.min(1, failedWeight / maxWeight);
  return Math.round(100 * (1 - ratio));
}
```

Even better: use a published, documented weighting model (e.g., Lighthouse-style) and **state that it is a heuristic**, not WCAG conformance. Always show the inputs and the formula version. Keep “rules failed” and “elements affected” separate.

---

## 12. Testing and quality plan

### 12.1 Unit tests

- URL validation: protocols, credentials, ports, IPv4/IPv6, decimal/hex forms, DNS failures, redirects.
- Private-IP classification: loopback, RFC1918, link-local, CGNAT, multicast, IPv6 ULA/link-local, IPv4-mapped IPv6.
- Score formula: known fixtures, boundaries, versioning.
- Colour parser: `#rgb`, `#rrggbb`, `rgb()`, invalid input, alpha (future).
- Heading skip detection: H1→H3, H2→H4, same-level, reset.
- History serialization: versioning, corruption, quota errors.

### 12.2 Integration tests (fixtures)

| Fixture | Expected |
|---|---|
| Good page | 0 violations, passes > 0 |
| Bad page | known violation ids |
| SPA shell | documents the limitation (or renders with Playwright) |
| Large page | completes under the timeout, payload capped |
| Non-HTML | 422 |
| 404 page | mapped error |
| Redirect to private IP | 403 |
| Slow server | 504 within the hard timeout |
| Infinite script | worker killed, server stays responsive |
| Malformed HTML | no crash |
| Non-UTF-8 page | text decoded correctly |

### 12.3 E2E tests (Playwright)

- Scan → results → issue filter/search/sort → expand → mark reviewed.
- Reload → history → view restored report.
- Compare two scans → issue-level diff.
- Contrast checker with valid/invalid colours.
- Alt-text/headings/forms pages.
- PDF generation (mock print).
- Keyboard-only walkthrough and screen-reader smoke test.
- 320 px viewport, 200% zoom, dark mode, reduced motion.

### 12.4 Security tests

- SSRF matrix as automated tests (no real internal targets; use a local test server with an allowlist for the test environment).
- Timeout/DoS test with a deliberately blocking fixture.
- Header assertions (CSP, HSTS, nosniff, frame options).
- Error-message leakage assertions.
- `npm audit --omit=dev` in CI.
- Dependency license check.

### 12.5 Accessibility tests for the tool itself

- Run axe-core on every page/state in CI.
- Manual keyboard walkthrough: skip link, sidebar, accordions, filters, forms, dialogs.
- Screen-reader smoke test (NVDA/VoiceOver) for the scan flow.
- Contrast token test in CI (fail on <4.5:1 for small text).
- `prefers-reduced-motion` and forced-colors checks.

### 12.6 Load/soak tests

- 10–50 concurrent scans; assert p95 latency, memory ceiling, no event-loop starvation.
- 1-hour soak; watch RSS growth (JSDOM leaks).
- Queue saturation → 503, not crash.
- Rate-limit correctness behind a proxy.

---

## 13. DevOps and release checklist

- [ ] `package.json`: `"engines": { "node": ">=20" }`, `"license": "MIT"`, `"repository"`, `"keywords"`, `"scripts": { "test", "lint", "format", "audit" }`.
- [ ] `.gitignore` (`node_modules`, `.env`, logs, coverage, dist).
- [ ] `.env.example` (`PORT`, `CORS_ORIGINS`, `RATE_LIMIT_MAX`, `ANALYSIS_TIMEOUT_MS`, `MAX_HTML_BYTES`, `REDIS_URL`).
- [ ] `LICENSE` (MIT text).
- [ ] `SECURITY.md` (reporting, supported versions, threat model).
- [ ] `CONTRIBUTING.md` and `CHANGELOG.md`.
- [ ] ESLint + Prettier + TypeScript/JSDoc.
- [ ] Unit/integration/E2E tests and coverage threshold.
- [ ] GitHub Actions: `npm ci`, lint, test, `npm audit --omit=dev`, build.
- [ ] Dockerfile (multi-stage, non-root user) + `.dockerignore`.
- [ ] Health/readiness endpoints.
- [ ] Graceful shutdown (`SIGTERM` → stop accepting, drain, close).
- [ ] Structured logging with request IDs; redact URLs/query strings.
- [ ] Error tracking (Sentry) and uptime monitoring.
- [ ] HTTPS + HSTS + CSP + SRI/self-hosted assets.
- [ ] `trust proxy` + Redis rate-limit store.
- [ ] Backups (if DB) and retention policy.
- [ ] Privacy policy and terms; URL/log retention statement.
- [ ] Deployment guide (Render/Railway/Fly/Docker).
- [ ] Post-deploy smoke test: scan a fixture, verify headers, verify 404/405, verify timeout.

---

## 14. Metrics and KPIs

| Metric | Target |
|---|---|
| Scan success rate (public pages) | >95% |
| p95 scan duration | <10 s |
| Timeout rate | <2% |
| Server crash/hang rate | 0 |
| Event-loop lag p99 | <200 ms |
| Memory per scan | <256 MB |
| Queue wait p95 | <5 s |
| Self-accessibility violations (axe) | 0 critical/serious |
| Self-contrast failures | 0 |
| High/critical dependency vulns | 0 |
| Test coverage (core modules) | >70% |
| History restore success | 100% |
| Issue-level diff accuracy (fixtures) | >95% |

---

## 15. 30/60/90-day plan

### Days 1–30 — safety and trust

- P0 security fixes (DoS, SSRF, timeout, error leakage, routing).
- Score/units/minor card/needs-review.
- Accordion focus, duplicate IDs, zero-issue state, stale results.
- Self-contrast and reduced-motion fixes.
- Add tests for the security fixes; add CI.
- Rewrite the README limitations/security sections.

### Days 31–60 — real reports

- Persist full scans (IndexedDB) and restore on View.
- Issue-level diff and “re-scan & compare”.
- JSON/CSV export and server-side PDF.
- Playwright-based contrast/SPA analysis (behind a flag).
- Multi-page crawl (limited).
- Rule/tag selector.
- Split frontend into modules; add E2E tests.

### Days 61–90 — product foundation

- Postgres + accounts/workspaces (optional).
- Queue/worker pool + Redis rate limits.
- Scheduled scans + alerts.
- GitHub Action + badge.
- Share links + API keys.
- Monitoring/error tracking.
- Docker/on-prem distribution.
- Public API docs.

---

## 16. File-by-file notes

### `server.js` (103 lines)

| Lines | Note |
|---|---|
| 17–19 | CSP disabled; enable a strict policy or self-host assets |
| 21–25 | CORS hardcoded to localhost:3000; make env-driven or remove |
| 28–33 | In-memory, per-IP rate limit; add global limit + shared store + `trust proxy` |
| 45–76 | URL validation + weak SSRF blocklist; replace with DNS/IP checks |
| 78–92 | Analysis call; raw error message leak at line 91 |
| 96–98 | Wildcard SPA fallback masks 404/405 and missing assets |
| 101–103 | No graceful shutdown/health check |

### `backend/analyzer.js` (189 lines)

| Lines | Note |
|---|---|
| 10–11 | Fetch timeout/size only; no analysis timeout |
| 39–57 | axios fetch; no redirect re-validation, no charset handling |
| 60–81 | jsdom with scripts/resources; fixed 400 ms; no `finally` close; DoS/SSRF root cause |
| 84–120 | Second parse, unclosed JSDOM, unbounded images/headings, `<img>` only |
| 123–142 | Formatting; good structure; 5-element cap |
| 145–187 | Orchestration; no score; `categories` unused; no incomplete details |

### `public/js/app.js` (1,406 lines)

| Lines | Note |
|---|---|
| 13–91 | Fix guidance (duplicates server suggestions) |
| 236–241 | Ad-hoc score formula |
| 246–268 | History stores compact issues, cap 20, no schema version |
| 281–312 | SPA navigation; no URL/hash/title update |
| 393–435 | Scan flow; no abort; stale results; weak error parsing |
| 465–540 | Results rendering; chart CDN dependency; no focus/announcement |
| 543–742 | PDF; double-print risk; popup dependency |
| 747–866 | Issue explorer; zero-issue bug; duplicate IDs; focus loss |
| 876–942 | Fix assistant; good content; collapsed focus issue |
| 947–1029 | Contrast checker; no alpha/HSL/named colours; NaN on invalid input |
| 1034–1081 | Alt-text page; `<img>` only |
| 1086–1138 | Keyboard checklist; global scope; focus loss; no explicit Not Tested |
| 1143–1188 | Headings; skip message bug; hidden headings |
| 1193–1229 | Forms; overpromises; duplicate IDs |
| 1234–1276 | History; View is `alert`; delete without confirm |
| 1281–1353 | Compare; summary only; no issue diff |
| 1358–1376 | Learning hub; static |
| 1381–1398 | Last-scan buttons broken after reload |
| 1403–1406 | Init; no restoration of `currentScan` |

### `public/index.html` (707 lines)

| Lines | Note |
|---|---|
| 7–9, 704 | CDN assets without SRI |
| 15 | Skip link (good) |
| 18–78 | Sidebar nav; 12 pages |
| 100 | `main` with `tabindex="-1"` (good) |
| 323–352 | Summary cards omit Minor; static cards have `tabindex="0"` |
| 359–360 | Chart canvas + `aria-hidden` legend |
| 407–431 | Issue filters lack `aria-pressed` |
| 472–481 | Colour inputs; no invalid feedback |
| 604–618 | Form page claim exceeds implementation |
| 690–702 | Footer; good disclaimer |

### `public/css/style.css` (687 lines)

| Lines | Note |
|---|---|
| 43–52 | Partial dark theme |
| 119–123 | Sidebar section label contrast 2.36:1 |
| 432–435 | Severity badge contrast failures |
| 444–448, 494–495, 632–636 | Collapsed content remains focusable; fixed max-height clipping |
| 558–565 | Checklist button contrast |
| 599–601 | History score white-on-colour contrast |
| 667–680 | Print styles (partial) |
| — | No `prefers-reduced-motion`, no `color-scheme`, no forced-colors |

### `README.md` (original)

- Friendly and well-structured for a student audience.
- Outdated feature list (8 pages missing).
- Factually wrong jsdom claim.
- Stale dependency versions and Node requirement.
- Missing API/security/limitations detail.

### `package.json`

- `author` empty; no repository/keywords.
- `engines` says `>=16` (should be `>=20`).
- No `test`/`lint`/`format`/`audit` scripts.
- MIT declared but no `LICENSE` file.
- Floating ranges and four majors behind.

---

## 17. Appendix — evidence and commands

### Commands used (summary)

```powershell
# Project inventory
Get-ChildItem -Force
(Get-Content public/js/app.js).Count
git rev-parse --show-toplevel

# Dependency audit
npm audit --json
npm outdated --json

# Live happy path
POST http://localhost:3000/api/analyze  { "url": "https://example.com" }

# SSRF probes
POST http://localhost:3000/api/analyze  { "url": "http://[::1]:9/" }
POST http://localhost:3000/api/analyze  { "url": "http://127.0.0.2:9/" }
POST http://localhost:3000/api/analyze  { "url": "http://10.example.com/" }

# Availability test
POST http://localhost:3000/api/analyze  { "url": "https://www.wikipedia.org" }

# jsdom probe (local fixture)
node probe.js   # inline scripts, subresources, axe color-contrast

# Contrast calculations
node contrast.js
```

### Key evidence

| Evidence | Result |
|---|---|
| `example.com` scan | 200, 1.2 s, 7 issues, 1 violation, 9 passes, 4 incomplete |
| `wikipedia.org` scan | client timeout 60 s; server unresponsive >90 s; CPU 278→370 s; RSS 183→237 MB |
| `[::1]:9` | 502, not 403 — SSRF filter bypassed |
| `127.0.0.2:9` | 502, not 403 — bypassed |
| `10.example.com` | 403 — false positive |
| jsdom inline script | executed |
| jsdom subresource | fetched |
| axe contrast | `incomplete`, not violation |
| `npm audit` | 2 moderate (dev), 0 high/critical |
| CSP header | absent |
| `GET /api/analyze` | 200 HTML (should be 404/405) |
| Missing asset | 200 HTML (should be 404) |
| Self-contrast | multiple failures (2.36:1, 2.84:1, 3.15:1, 3.30:1, 4.34:1, 4.41:1) |

### Assumptions and limits of this review

- The review is based on the code in the working directory and a live run on Node 24 / Windows.
- The `wikipedia.org` hang may be caused by one or more of its scripts/subresources; the architectural risk is confirmed regardless of the exact script.
- I did not attempt to exploit a sandbox escape or scan real internal services; SSRF findings are based on filter logic and safe connection-refused tests.
- I did not run a screen reader; accessibility findings are code/CSS/ARIA analysis plus measured contrast.
- I did not modify application source code; only this analysis file was added.
- The running dev server was restarted after the DoS test (old PID 24292 → new PID 27868).

---

## 18. Closing assessment

DesignLens is a **good mini-project with a real product idea and unusually broad feature coverage**. The UI is pleasant, the fix guidance is genuinely useful, and the basic scan flow works. The project’s biggest asset is its **educational clarity**; its biggest liability is that the backend trusts the open internet far too much.

The gap between “demo” and “production” is not the number of features — it is **trust**. A user must be able to believe that:

1. the server will not go down when they scan a heavy site;
2. the scanner cannot be used to reach internal services;
3. “no contrast issues” actually means contrast was checked;
4. the score and history mean what they say;
5. the tool itself is accessible.

Fixing those five things — plus a handful of focus/contrast/duplicate-ID bugs — would move this from a **7/10 mini-project** to a **credible accessibility product**. Everything else in this document is upside.

**Recommended next action:** implement the six P0 items in section 9.1, add the regression tests in section 12.4, and rewrite the limitations/security sections of the original README. That is a focused 2–3 day sprint with a disproportionate impact on safety and credibility.

---

*End of analysis.*
