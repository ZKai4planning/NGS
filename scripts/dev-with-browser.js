// scripts/dev-with-browser.js
//
// Dev-only orchestrator: starts `next dev`, waits for it to respond,
// then opens the ephemeral localhost-only Playwright browser.
// Wire this to your "dev" script only — never to "build" or "start" —
// so it never runs in production.

const { spawn } = require('child_process');
const http = require('http');
const { launchLocalhostBrowser } = require('./localhost-browser');

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;
const MAX_WAIT_MS = 30000;
const POLL_INTERVAL_MS = 300;

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
        } else {
          setTimeout(check, POLL_INTERVAL_MS);
        }
      });
    };
    check();
  });
}

(async () => {
  // Forward any extra CLI args (e.g. `npm run dev -- --turbo`) to next dev.
  const extraArgs = process.argv.slice(2);
  const devServer = spawn(
    'npx',
    ['next', 'dev', '-p', String(PORT), ...extraArgs],
    { stdio: 'inherit', shell: true }
  );

  let browserHandle = null;
  let shuttingDown = false;

  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (browserHandle) await browserHandle.close().catch(() => {});
    if (!devServer.killed) devServer.kill('SIGTERM');
    process.exit(code);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  devServer.on('exit', (code) => shutdown(code ?? 0));

  try {
    await waitForServer(URL, MAX_WAIT_MS);
    browserHandle = await launchLocalhostBrowser(URL);
    browserHandle.onClose(() => {
      console.log('[dev-browser] Closed. Dev server keeps running (Ctrl+C to stop it).');
    });
  } catch (err) {
    console.warn(`[dev-browser] Could not auto-open browser: ${err.message}`);
  }
})();
