# 🔍 DesignLens – Comprehensive Project Analysis & Security Audit

> **Historical snapshot:** This document predates the current branch's stabilization changes. Its status table, security recommendations, and quantitative claims are not a current audit. Use [AUDIT_REPORT.md](AUDIT_REPORT.md) and [the technical and academic report](docs/TECHNICAL_AND_ACADEMIC_REPORT.md) as the current source of truth.

> **Document Version:** 2.0  
> **Date:** November 2026  
> **Project:** DesignLens – Website Accessibility Analyzer  
> **Target Standard:** WCAG 2.1 / 2.2 AA Compliance Analyzer  

---

## 1. Executive Summary: Where the Project Stands

**DesignLens** has evolved from a basic mini-project into a functional, feature-rich accessibility audit workspace. It combines automated rule verification powered by **axe-core** with supplementary manual testing utilities, visualization, and guidance tools.

### Current Implementation Scorecard

| Area | Status | Implementation Details |
| :--- | :---: | :--- |
| **Automated WCAG Scanner** | 🟢 **Complete** | Node.js + Express backend running `axe-core` inside a `jsdom` sandbox. Analyzes any valid public webpage. |
| **Severity & Scoring Engine** | 🟢 **Complete** | Transparent scoring formula: `100 - (Critical×10 + Serious×5 + Moderate×2 + Minor×1)`. |
| **Interactive Issue Explorer** | 🟢 **Complete** | Filter by severity, real-time keyword search, sort by count/severity/alphabetical, mark-as-reviewed state. |
| **Smart Fix Assistant** | 🟢 **Complete** | Pre-configured before/after code blocks, why-it-matters explanations, and one-click copy buttons for common axe rules. |
| **Colour Contrast Checker** | 🟢 **Complete** | Interactive color picker & hex/rgb input with live normal/large text preview, calculating contrast ratio against WCAG AA (4.5:1 / 3:1) and AAA (7:1 / 4.5:1). |
| **Alt-Text Analyzer** | 🟢 **Complete** | Extracts all `<img>` tags; categorizes them into `has-alt`, `empty-alt` (decorative), and `missing-alt`. |
| **Heading Structure Analyzer** | 🟢 **Complete** | Extracts H1–H6 hierarchy, warns against skipped heading levels, and counts total headings. |
| **Form Accessibility Checker**| 🟢 **Complete** | Audits form controls, missing labels, button accessible names, and input associations. |
| **Keyboard Checklist** | 🟢 **Complete** | 12-point manual evaluation checklist with Pass/Fail/NA toggles and notes, persisted in `localStorage`. |
| **Scan History & Comparison** | 🟢 **Complete** | Stores recent scans client-side; includes a side-by-side Before & After delta comparator. |
| **Printable Report Engine** | 🟢 **Complete** | Dedicated print-window rendering with formatted scorecards, metrics, heading tree, and violations without external CDN failures. |
| **UI/UX & Accessibility** | 🟢 **Complete** | Responsive deep-navy sidebar layout, dark/light theme toggle, skip-link, semantic landmarks, ARIA attributes. |

---

## 2. In-Depth Audit: Weaknesses & Limitations

While the application is performant and functional for single-page automated audits, a critical technical assessment identifies the following weaknesses:

### A. Security Weaknesses
1. **SSRF (Server-Side Request Forgery) Edge Cases:**
   - *Current defense:* `server.js` checks hostname strings against blacklist patterns (`localhost`, `127.0.0.1`, `10.`, `192.168.`, `169.254.169.254`).
   - *Vulnerability:* DNS rebinding attacks, decimal/hex IP representations (e.g. `http://2130706433` resolving to 127.0.0.1), or custom DNS names pointing to internal loopback addresses can bypass naive hostname string inspection.
   - *Recommendation:* Perform DNS resolution (`dns.lookup`) prior to dispatching requests and check the resolved IP against `ipaddr.js` private CIDR ranges. Also re-validate redirect targets.
2. **JSDOM Script Execution Risks:**
   - *Current defense:* `runScripts: 'dangerously'` is enabled so `window.eval(axe.source)` can inject axe-core.
   - *Risk:* If external HTML contains embedded scripts and jsdom resources are executed, malicious external JavaScript could execute inside the backend process.
   - *Mitigation:* While `fetchHtml` passes raw HTML, ensure inline scripts are stripped before loading into JSDOM, or transition to an isolated headless Chrome instance via Puppeteer.
3. **Denial of Service (DoS) via Large Payloads:**
   - Large or recursive DOM structures (e.g., 50MB HTML pages or infinite DOM trees) can cause Node.js memory spikes or high CPU consumption during JSDOM parsing.
   - *Mitigation:* The 5MB size limit and 15s timeout are good; consider adding a max DOM node count check before running axe.

### B. Functional & Engine Limitations
1. **Headless Browser vs. JSDOM:**
   - Modern web apps (React, Vue, Angular, Next.js) rely heavily on client-side rendering (CSR). JSDOM only parses the initial SSR/HTML response returned by Axios; it does not execute full Single Page Application client bundles.
   - *Consequence:* Modern SPAs that render content via client-side JavaScript will appear empty or under-evaluated.
   - *Fix:* Introduce optional headless browser scanning via **Puppeteer** or **Playwright** with network-idle waiting.
2. **Dynamic Pseudo-classes & Computed CSS:**
   - JSDOM does not implement a full browser layout/rendering engine. Certain CSS contrast checks that depend on complex computed cascade, background images, linear gradients, or z-index overlays cannot be 100% verified in JSDOM.
3. **Client-Side Only History Persistence:**
   - Scan history and manual checklist notes live in browser `localStorage`. Clearing cache or switching devices loses this history.

---

## 3. Recommended Improvements & Upgrades

### Short-Term Improvements (Quick Wins)
- [ ] **DNS Resolution SSRF Guard:** Integrate `ip-address` / `ipaddr.js` verification to resolve hostnames before fetching.
- [ ] **Filter Script Tags before JSDOM:** Strip `<script>` tags from the fetched HTML before injecting into JSDOM so arbitrary scripts never execute.
- [ ] **Export Options:** Add JSON and CSV export formats alongside the current printable PDF report.
- [ ] **Expanded Fix Library:** Expand `FIX_GUIDANCE` to cover 40+ axe rules with direct MDN and W3C WCAG technique links.
- [ ] **Batch URL Scan List:** Allow users to paste up to 5 URLs to run sequential evaluations.

### Medium-Term Architectural Upgrades
- [ ] **Puppeteer Hybrid Mode:** Allow user to choose "Fast Scan" (JSDOM, ~1s) or "Full Render Scan" (Puppeteer, captures SPAs, JavaScript-rendered elements, and computed CSS).
- [ ] **Database Integration:** Connect MongoDB / PostgreSQL via Prisma or Mongoose to save scans, user accounts, and historical trends permanently.
- [ ] **Automated Accessibility Testing in CI/CD:** Package DesignLens engine as a CLI tool or GitHub Action (`designlens-action`) to fail PRs when critical violations occur.
- [ ] **WCAG 2.2 Target Filter:** Allow filtering issues specifically by WCAG version (2.0, 2.1, 2.2) and Conformance Level (A, AA, AAA).

### Long-Term Vision & Advanced Features
- [ ] **Multi-Page Crawler:** Same-domain link spider with breadth-first crawling up to configurable depth (e.g., 10 pages).
- [ ] **AI-Assisted Code Repair:** Integrate an optional LLM endpoint (Gemini / Claude API) with clear disclaimers to propose tailored component-level diffs based on the exact DOM context.
- [ ] **Scheduled Monitoring & Alerts:** Webhook or email notifications when a monitored site's accessibility score drops below a configured threshold.
- [ ] **Screen Reader Simulator / Audio Preview:** Generate synthetic audio demonstrating how a screen reader (NVDA/VoiceOver) traverses the detected heading tree and landmarks.

---

## 4. Compliance & Legal Disclaimer

DesignLens is an automated diagnostic and learning tool. Automated accessibility testing typically covers **30% to 50%** of WCAG criteria. Issues such as logical reading order, cognitive clarity, appropriate alt-text semantics, and assistive device compatibility require thorough human evaluation. Automated results do not constitute a legal certificate of compliance.
