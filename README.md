# DesignLens

DesignLens is a browser-based website accessibility analysis tool. It fetches a public HTML page, checks its static document with axe-core, and presents violations and supporting utilities for reviewing images, headings, forms, and color pairs.

> **Scope:** The GitHub repository is DesignLens, not “S Campus Care.” This project has no campus complaint workflow, user accounts, database, AI model, or machine-learning predictions. axe-core is a rule engine. The current scanner analyzes the initial HTML response; it does not render client-side applications or certify WCAG conformance.

## Features

- Static-page accessibility scan using axe-core WCAG 2.0/2.1/2.2 A/AA and best-practice tags.
- Severity counts, issue details, affected HTML snippets, and suggested fixes.
- Browser-side color contrast calculator, image-alt and heading summaries, form review, keyboard checklist, scan history, and comparison.
- More Checks workspace: link and in-page target review, table structure, page title/language/landmarks, alt-text wording hints, media caption-track review, and control-name checks.
- Guided form-error, keyboard-focus, zoom/reflow, and PDF accessibility reviews. Manual results are saved in this browser; selected PDFs stay local and are not automatically parsed.
- Print-friendly report and learning hub.
- JSON and CSV exports, plus issue-level comparisons between saved scans.

Scan history and manual checklist state are stored in the current browser. There is no server-side persistence.

## Architecture

```text
Browser (HTML/CSS/JavaScript; Bootstrap and Chart.js from jsDelivr)
  ├─ POST /api/analyze { url }
  └─ localStorage/sessionStorage
       ↓
Express + Helmet + rate limiting
  └─ analyzer worker (maximum 2 concurrent)
       ├─ Axios fetch; public DNS/IP validation; no redirects
       ├─ JSDOM with page scripts and subresources disabled
       └─ axe-core → JSON results
```

## Requirements and setup

- Node.js 18 or newer and npm.

```powershell
npm ci
npm start
```

Open <http://localhost:3000>. For development with auto-restart, run `npm run dev`.

## Hosting

The GitHub Actions workflow publishes the static frontend from `public/` to GitHub Pages. The API migration target is Amazon ECS Express Mode on Fargate, with configurable task CPU and memory. The AWS deployment workflow is gated until `AWS_DEPLOYMENT_ENABLED` is set to `true`. See [docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md) for AWS and GitHub setup.

For the split setup, set the GitHub Pages workflow variable `DESIGNLENS_API_BASE` to the live API URL, without a trailing slash, and choose GitHub Actions as the source in repository Settings → Pages. The existing frontend contract stays `POST /api/analyze`.

The Pages project URL is `https://ayushjaiswal001.github.io/designlens/`. If the API URL variable is empty, the hosted interface displays a setup message when a scan is submitted.

## API

### `GET /api/health`

Returns `{ "status": "ok" }`.

### `POST /api/analyze`

Request JSON: `{ "url": "https://example.com" }`. Only HTTP/HTTPS URLs using standard ports are accepted. Targets must resolve exclusively to public IP addresses. Redirects are rejected; submit the final URL directly. Responses include the URL, scan timestamp and duration, violation list, severity counts by affected element, axe pass/incomplete counts, and static summaries for images, headings, links, tables, media, controls, page metadata, and forms. Scans run the available axe-core WCAG 2.0, 2.1, and 2.2 A/AA tags plus best-practice rules.

Errors use appropriate 4xx/5xx statuses and generic client-facing messages. Unexpected failures include a request ID for server-log correlation.

## Security and analysis limits

- URL DNS answers are checked and pinned for the request; private, reserved, loopback, link-local, and non-unicast addresses are rejected.
- Redirects and nonstandard ports are rejected. The analyzer does not execute scanned page scripts or load its subresources.
- Analysis runs in a worker thread with a 120-second hard deadline and two-scan concurrency limit. This limits hangs; it is not a full OS process or memory sandbox.
- The API is intended for local/student demonstration. A public deployment still needs operational controls such as proxy-aware client IP configuration, request monitoring, and infrastructure-level egress restrictions.
- JSDOM has no browser layout engine. Color contrast in the scan cannot be reliably evaluated; use the separate solid-color calculator and manually inspect rendered pages.
- Wording checks for alt text and links are heuristics. Focus order, real form error behavior, zoom/reflow, transcripts, and PDF structure require manual or browser/document testing. The PDF tool is a guided checklist, not an automated PDF parser.
- Single-page applications, authenticated pages, iframes, and content added after page load are outside the current scan scope.

## Testing and project documents

Run the automated checks with `npm test`. The current findings and feature ideas are in [docs/UI_AUDIT_AND_FEATURE_IDEAS.md](docs/UI_AUDIT_AND_FEATURE_IDEAS.md); the repository audit and technical/academic report are in [AUDIT_REPORT.md](AUDIT_REPORT.md) and [docs/TECHNICAL_AND_ACADEMIC_REPORT.md](docs/TECHNICAL_AND_ACADEMIC_REPORT.md).

## License

MIT (see package metadata).
