// scripts/open-browser.js
//
// Reopens the ephemeral localhost browser without restarting `next dev`.
// Use this when you accidentally closed the browser window but the dev
// server (started by `npm run dev`) is still running in another terminal.
//
// Usage:
//   node scripts/open-browser.js          # opens http://localhost:3000
//   node scripts/open-browser.js 5173     # opens http://localhost:5173
//   PORT=4000 node scripts/open-browser.js

const { launchLocalhostBrowser } = require('./localhost-browser');

const portArg = process.argv[2];
const PORT = portArg || process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;

(async () => {
  try {
    const browserHandle = await launchLocalhostBrowser(URL);
    browserHandle.onClose(() => {
      console.log('[dev-browser] Closed.');
      process.exit(0);
    });
  } catch (err) {
    console.error(`[dev-browser] Could not open browser: ${err.message}`);
    process.exit(1);
  }
})();
