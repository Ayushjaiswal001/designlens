/** DesignLens HTTP API and static frontend server. */
'use strict';

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { analyzeUrl, isPublicAddress } = require('./backend/analyzer');

const PORT = Number(process.env.PORT) || 3000;

function createApp({ analyze = analyzeUrl, logger = console, allowedOrigins = process.env.DESIGNLENS_ALLOWED_ORIGINS || '' } = {}) {
  const app = express();
  const allowedOriginSet = new Set(String(allowedOrigins).split(',').map(origin => origin.trim()).filter(Boolean));
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  app.use((req, res, next) => {
    const origin = req.get('Origin');
    const isAllowed = origin && allowedOriginSet.has(origin);
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
    }
    if (req.method === 'OPTIONS') {
      if (!isAllowed) return res.status(403).json({ error: 'Origin not allowed.' });
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '10kb', strict: true }));
  app.use(express.static(path.join(__dirname, 'public'), { fallthrough: true, index: 'index.html' }));

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a few minutes and try again.' }
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/analyze', limiter, async (req, res) => {
    const { url } = req.body || {};
    if (typeof url !== 'string' || !url.trim() || url.length > 2048) {
      return res.status(400).json({ error: 'Provide a URL up to 2048 characters long.' });
    }
    let parsedUrl;
    try { parsedUrl = new URL(url.trim()); }
    catch { return res.status(400).json({ error: 'Invalid URL. Include http:// or https://.' }); }
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      return res.status(400).json({ error: 'Only public HTTP and HTTPS URLs are supported.' });
    }
    if (parsedUrl.port && !((parsedUrl.protocol === 'http:' && parsedUrl.port === '80') ||
        (parsedUrl.protocol === 'https:' && parsedUrl.port === '443'))) {
      return res.status(400).json({ error: 'Only standard website ports 80 and 443 are supported.' });
    }
    const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
        (net.isIP(hostname) && !isPublicAddress(hostname))) {
      return res.status(403).json({ error: 'Scanning private or non-public network addresses is not allowed.' });
    }

    const requestId = crypto.randomUUID();
    try {
      const results = await analyze(parsedUrl.href);
      return res.json(results);
    } catch (error) {
      logger.error(`[${requestId}] Analysis failed (${error.code || 'UNKNOWN'}): ${error.stack || error.message}`);
      if (error.code === 'ERR_BLOCKED_ADDRESS') {
        return res.status(403).json({ error: 'Scanning private or non-public network addresses is not allowed.' });
      }
      if (error.code === 'ERR_REDIRECT_BLOCKED') return res.status(422).json({ error: error.message });
      if (error.code === 'ERR_NOT_HTML') return res.status(422).json({ error: error.message });
      if (error.code === 'ERR_ANALYSIS_BUSY') return res.status(503).json({ error: 'The analyzer is busy. Try again shortly.' });
      if (error.code === 'ERR_ANALYSIS_TIMEOUT' || error.code === 'ECONNABORTED') {
        return res.status(504).json({ error: 'Analysis timed out. The site may be unavailable or too complex.' });
      }
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'EAI_AGAIN') {
        return res.status(502).json({ error: 'Could not reach that website. Check the URL and try again.' });
      }
      return res.status(500).json({ error: 'Analysis failed. Try again later.', requestId });
    }
  });

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
    if (!req.accepts('html')) return next();
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large' || error.type === 'entity.parse.failed') {
      return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid or oversized JSON request.' });
    }
    logger.error('Unhandled request error:', error.message);
    return res.status(500).json({ error: 'Unexpected server error.' });
  });
  return app;
}

if (require.main === module) {
  const server = createApp().listen(PORT, () => loggerMessage(`DesignLens is running at http://localhost:${PORT}`));
  function loggerMessage(message) { console.log(`\n🔍 ${message}\n`); }
  process.once('SIGINT', () => server.close(() => process.exit(0)));
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createApp };
