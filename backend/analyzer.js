/** DesignLens accessibility analysis pipeline. */
'use strict';

const axios = require('axios');
const dns = require('node:dns').promises;
const { Worker } = require('node:worker_threads');
const { JSDOM, VirtualConsole } = require('jsdom');
const axe = require('axe-core');
const ipaddr = require('ipaddr.js');

const FETCH_TIMEOUT_MS = 12_000;
// The free Render instance has limited CPU; large but valid pages need more
// time for axe-core to finish on that plan.
const ANALYSIS_TIMEOUT_MS = 60_000;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_CONCURRENT_SCANS = 2;
let activeScans = 0;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'];
const SCAN_STANDARDS = ['WCAG 2.0 A/AA', 'WCAG 2.1 A/AA', 'WCAG 2.2 A/AA', 'axe-core best practices'];

const SEVERITY_LABEL = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };
const FIX_SUGGESTIONS = {
  'image-alt': 'Add descriptive alt text to meaningful images. Use alt="" for decorative images.',
  'color-contrast': 'Check text and background colors in a rendered browser; this static scan cannot measure layout contrast.',
  'heading-order': 'Use headings in a logical order without skipping levels unnecessarily.',
  label: 'Associate each form control with a visible label or accessible name.',
  'button-name': 'Give each button a clear visible or programmatic name.',
  'link-name': 'Give each link descriptive text that explains its destination.',
  'landmark-one-main': 'Place the primary page content inside a main landmark.',
  'page-has-heading-one': 'Add a descriptive level-one heading.',
  'document-title': 'Add a descriptive document title.',
  'html-has-lang': 'Set the page language on the html element.',
  'frame-title': 'Give each iframe a descriptive title.',
  'duplicate-id': 'Ensure every id value is unique within the page.'
};

function isPublicAddress(address) {
  try {
    return ipaddr.parse(address).range() === 'unicast';
  } catch {
    return false;
  }
}

function createSafeLookup() {
  return function safeLookup(hostname, ...args) {
    const callback = args.find(argument => typeof argument === 'function');
    const options = args.find(argument => argument && typeof argument === 'object') || {};
    if (!callback) throw new Error(`DNS lookup callback was not provided (arguments: ${args.map(argument => typeof argument).join(', ')}).`);
    const normalizedHost = hostname.replace(/^\[|\]$/g, '');
    const resolveAnswers = ipaddr.isValid(normalizedHost)
      ? Promise.resolve([{ address: normalizedHost, family: ipaddr.parse(normalizedHost).kind() === 'ipv6' ? 6 : 4 }])
      : dns.lookup(normalizedHost, { all: true, verbatim: true });
    resolveAnswers.then(answers => {
      if (!answers.length || answers.some(answer => !isPublicAddress(answer.address))) {
        const error = new Error('Target host does not resolve exclusively to public addresses.');
        error.code = 'ERR_BLOCKED_ADDRESS';
        callback(error);
        return;
      }
      // The vetted DNS answer is passed directly to the socket; it is not resolved again.
      if (options.all) callback(null, answers);
      else callback(null, answers[0].address, answers[0].family);
    }, callback);
  };
}

async function fetchHtml(url) {
  let response;
  try {
    response = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_SIZE_BYTES,
      maxBodyLength: MAX_SIZE_BYTES,
      responseType: 'text',
      maxRedirects: 0,
      proxy: false,
      lookup: createSafeLookup(),
      headers: {
        'User-Agent': 'DesignLens-Accessibility-Analyzer/2.0',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
  } catch (error) {
    if (error.code === 'ERR_BLOCKED_ADDRESS') throw error;
    if (error.response && error.response.status >= 300 && error.response.status < 400) {
      const redirectError = new Error('Redirects are not followed. Scan the final public URL directly.');
      redirectError.code = 'ERR_REDIRECT_BLOCKED';
      throw redirectError;
    }
    throw error;
  }
  if (!response.data || typeof response.data !== 'string') throw new Error('The server returned an empty response.');
  const contentType = response.headers['content-type'] || '';
  if (!/\bhtml\b/i.test(contentType)) {
    const error = new Error('The URL did not return an HTML page.');
    error.code = 'ERR_NOT_HTML';
    throw error;
  }
  return response.data;
}

async function runAxe(html, url) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url,
    virtualConsole,
    runScripts: 'outside-only', // Only inject our trusted axe bundle; never run target scripts.
    resources: undefined,
    pretendToBeVisual: true
  });
  try {
    const { window } = dom;
    window.eval(axe.source);
    return await new Promise((resolve, reject) => {
      window.axe.run(window.document, {
        runOnly: { type: 'tag', values: AXE_TAGS }
      }, (error, results) => error ? reject(error) : resolve(results));
    });
  } finally {
    dom.window.close();
  }
}

function extractPageData(html, url) {
  const dom = new JSDOM(html, { url });
  try {
    const { document } = dom.window;
    const trim = (value, max = 240) => (value || '').replace(/\s+/g, ' ').trim().substring(0, max);
    const images = Array.from(document.querySelectorAll('img'), image => {
      const hasAlt = image.hasAttribute('alt');
      const alt = hasAlt ? image.getAttribute('alt') : null;
      const source = image.getAttribute('src') || '';
      const hints = [];
      if (alt && /^(image|photo|picture|graphic|icon|logo)(\s*\d*)?$/i.test(trim(alt))) hints.push('Generic wording — check whether the image purpose needs more detail.');
      const basename = source.split(/[/?#]/).pop()?.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').toLowerCase();
      if (alt && basename && trim(alt).toLowerCase() === basename) hints.push('Alt text matches the image filename — review whether it describes the image.');
      if (alt && alt.length > 150) hints.push('Long alt text — check whether a shorter description or nearby text would work better.');
      return {
        src: source.substring(0, 200), alt,
        status: !hasAlt ? 'missing-alt' : alt === '' ? 'empty-alt' : 'has-alt',
        reviewHints: hints
      };
    });
    const altGroups = new Map();
    images.filter(image => image.alt).forEach(image => altGroups.set(image.alt.trim().toLowerCase(), (altGroups.get(image.alt.trim().toLowerCase()) || 0) + 1));
    images.forEach(image => {
      if (image.alt && altGroups.get(image.alt.trim().toLowerCase()) > 1 && !image.reviewHints.includes('Repeated alt text — check whether each image has a different purpose.')) {
        image.reviewHints.push('Repeated alt text — check whether each image has a different purpose.');
      }
    });

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'), heading => ({
      level: Number(heading.tagName[1]), text: trim(heading.textContent, 120)
    }));
    const pageUrl = new URL(url);
    const ids = new Set(Array.from(document.querySelectorAll('[id]'), element => element.id));
    const genericLinkText = /^(click here|here|read more|learn more|more|link|go|details|view more|more info)(\s*…?)?$/i;
    const links = Array.from(document.querySelectorAll('a[href]'), link => {
      const imageAlt = Array.from(link.querySelectorAll('img[alt]')).map(image => trim(image.getAttribute('alt'))).filter(Boolean).join(' ');
      const labelledBy = (link.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map(id => trim(document.getElementById(id)?.textContent || '')).join(' ');
      const text = trim(link.getAttribute('aria-label')) || trim(labelledBy) || trim(link.textContent) || trim(link.getAttribute('title')) || trim(imageAlt, 160);
      const href = (link.getAttribute('href') || '').trim();
      let brokenFragment = false;
      const emptyFragment = href === '#';
      try {
        const target = new URL(href, pageUrl);
        if (target.origin === pageUrl.origin && target.pathname === pageUrl.pathname && target.search === pageUrl.search && target.hash) {
          let fragment = target.hash.slice(1);
          try { fragment = decodeURIComponent(fragment); } catch {}
          brokenFragment = !ids.has(fragment);
        }
      } catch {}
      return { text, href: href.substring(0, 220), emptyName: !text, vagueName: !!text && genericLinkText.test(text), brokenFragment: brokenFragment || emptyFragment };
    }).slice(0, 250);

    const tables = Array.from(document.querySelectorAll('table'), (table, index) => {
      const headers = table.querySelectorAll('th').length;
      const caption = trim(table.querySelector('caption')?.textContent, 160);
      const presentational = table.getAttribute('role') === 'presentation' || table.getAttribute('aria-hidden') === 'true';
      const reviewHints = [];
      if (!presentational && headers === 0) reviewHints.push('No header cells found — if this is data, add row or column headers.');
      if (!presentational && !caption) reviewHints.push('No caption found — check whether users need a title or summary for this table.');
      return { index: index + 1, caption, headerCount: headers, rowCount: table.querySelectorAll('tr').length, presentational, reviewHints };
    }).slice(0, 100);

    const controls = Array.from(document.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],[role="button"],[role="link"]'), control => {
      const labelText = Array.from(document.querySelectorAll('label[for]'))
        .filter(label => control.id && label.htmlFor === control.id).map(label => trim(label.textContent)).join(' ') || trim(control.closest('label')?.textContent || '');
      const labelledBy = (control.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map(id => trim(document.getElementById(id)?.textContent || '')).join(' ');
      const imageAlt = control.getAttribute('alt') || Array.from(control.querySelectorAll('img[alt]')).map(image => image.getAttribute('alt')).filter(Boolean).join(' ');
      const name = trim(control.getAttribute('aria-label')) || trim(labelledBy) || trim(labelText) ||
        trim(control.getAttribute('title')) || trim(imageAlt) || trim(control.textContent) || trim(control.value);
      return { tag: control.tagName.toLowerCase(), type: control.getAttribute('type') || '', name, missingName: !name, id: (control.id || '').substring(0, 100) };
    }).slice(0, 300);

    const media = Array.from(document.querySelectorAll('video,audio'), (element, index) => {
      const kind = element.tagName.toLowerCase();
      const captions = !!element.querySelector('track[kind="captions"],track[kind="subtitles"]');
      return { index: index + 1, kind, captions, hasTranscriptLink: false };
    }).slice(0, 100);

    const title = trim(document.querySelector('title')?.textContent, 180);
    const lang = trim(document.documentElement.getAttribute('lang') || document.documentElement.getAttribute('xml:lang'), 32);
    const viewport = trim(document.querySelector('meta[name="viewport"]')?.getAttribute('content'), 240);
    const landmarks = {
      main: document.querySelectorAll('main,[role="main"]').length,
      nav: document.querySelectorAll('nav,[role="navigation"]').length,
      banner: document.querySelectorAll('header,[role="banner"]').length,
      contentinfo: document.querySelectorAll('footer,[role="contentinfo"]').length
    };
    const skipLinks = Array.from(document.querySelectorAll('a[href^="#"]')).filter(link => /skip|jump to|bypass/i.test(trim(link.textContent || link.getAttribute('aria-label')))).length;
    const controlsWithMissingNames = controls.filter(control => control.missingName);
    const viewportBlocksZoom = /user-scalable\s*=\s*no|max(?:imum)?-scale\s*=\s*(?:1(?:\.0*)?|[0-3](?:\.\d+)?)(?:\s|,|$)/i.test(viewport);
    return {
      images, headings, links, tables, controls, media,
      formCount: document.querySelectorAll('form').length,
      pageBasics: { title, lang, viewport, landmarks, skipLinks, viewportBlocksZoom },
      controlNameSummary: { total: controls.length, missing: controlsWithMissingNames.length }
    };
  } finally {
    dom.window.close();
  }
}

function formatViolation(violation) {
  const impact = violation.impact || 'minor';
  const affectedElements = (violation.nodes || []).slice(0, 5).map(node => ({
    html: node.html ? node.html.substring(0, 300) : '',
    target: node.target ? node.target.join(', ') : '',
    failureSummary: node.failureSummary || ''
  }));
  return {
    id: violation.id,
    name: violation.help || violation.id,
    description: violation.description || '',
    helpUrl: violation.helpUrl || '',
    tags: violation.tags || [],
    severity: impact,
    severityLabel: SEVERITY_LABEL[impact] || 'Minor',
    affectedElements,
    affectedCount: (violation.nodes || []).length,
    suggestion: FIX_SUGGESTIONS[violation.id] || `Review the axe-core guidance for "${violation.id}".`
  };
}

async function analyzeUrlUnsafe(url) {
  const startTime = Date.now();
  const html = await fetchHtml(url);
  const [axeResults, pageData] = await Promise.all([runAxe(html, url), Promise.resolve(extractPageData(html, url))]);
  const issues = (axeResults.violations || []).map(formatViolation);
  const severityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const issue of issues) severityCounts[issue.severity in severityCounts ? issue.severity : 'minor'] += issue.affectedCount;
  const categories = {};
  for (const violation of axeResults.violations || []) {
    for (const tag of violation.tags || []) {
      if (tag.startsWith('wcag') || tag === 'best-practice') categories[tag] = (categories[tag] || 0) + (violation.nodes || []).length;
    }
  }
  return {
    url, scannedAt: new Date().toISOString(), durationMs: Date.now() - startTime,
    standards: SCAN_STANDARDS,
    totalIssues: issues.reduce((sum, issue) => sum + issue.affectedCount, 0),
    totalViolations: issues.length, severityCounts, categories, issues,
    passes: (axeResults.passes || []).length, incomplete: (axeResults.incomplete || []).length,
    ...pageData
  };
}

function analyzeUrl(url) {
  if (activeScans >= MAX_CONCURRENT_SCANS) {
    const error = new Error('Analysis capacity is busy. Try again shortly.');
    error.code = 'ERR_ANALYSIS_BUSY';
    return Promise.reject(error);
  }
  activeScans += 1;
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    require(workerData.modulePath).analyzeUrlUnsafe(workerData.url)
      .then(result => parentPort.postMessage({ result }))
      .catch(error => parentPort.postMessage({ error: { message: error.message, code: error.code, stack: error.stack } }));
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true, workerData: { modulePath: __filename, url } });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      const error = new Error('Analysis exceeded its time limit.');
      error.code = 'ERR_ANALYSIS_TIMEOUT';
      reject(error);
    }, ANALYSIS_TIMEOUT_MS);
    worker.once('message', message => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (message.error) {
        const error = new Error(message.error.message);
        error.code = message.error.code;
        error.stack = message.error.stack;
        reject(error);
      } else resolve(message.result);
    });
    worker.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', code => {
      if (!settled && code !== 0) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('Analysis worker exited unexpectedly.'));
      }
    });
  }).finally(() => { activeScans -= 1; });
}

module.exports = { analyzeUrl, analyzeUrlUnsafe, fetchHtml, isPublicAddress, runAxe, extractPageData, AXE_TAGS, SCAN_STANDARDS };
