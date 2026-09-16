// scripts/postinstall.js
//
// Runs `playwright install chromium` automatically after `npm install`,
// but only when this is a real dev install — never in production.
//
// Guards, any of which skips the install:
//   1. `playwright` isn't resolvable at all. This is the main guard: when
//      someone runs `npm ci --omit=dev` (or `npm install --production`,
//      or CI/Docker sets NODE_ENV=production before install), npm never
//      installs devDependencies, so `playwright` simply won't be there —
//      require.resolve() throws and we exit quietly, no npx call, no
//      download, no error surfaced to the install.
//   2. NODE_ENV=production is set, even if playwright somehow resolves
//      (e.g. a hoisted monorepo install) — explicit opt-out.
//   3. CI=true and SKIP_PLAYWRIGHT_INSTALL isn't overridden — avoids
//      surprise multi-hundred-MB browser downloads slowing down CI jobs
//      that don't actually run the dev browser (e.g. lint/test-only CI).
//      Set SKIP_PLAYWRIGHT_INSTALL=0 to force it in a CI job that does
//      need it (e.g. an E2E job already using Playwright).

function shouldSkip() {
  if (process.env.NODE_ENV === 'production') {
    return 'NODE_ENV=production';
  }

  if (process.env.SKIP_PLAYWRIGHT_INSTALL === '1') {
    return 'SKIP_PLAYWRIGHT_INSTALL=1';
  }

  if (process.env.CI && process.env.SKIP_PLAYWRIGHT_INSTALL !== '0') {
    return 'CI environment (set SKIP_PLAYWRIGHT_INSTALL=0 to override)';
  }

  try {
    require.resolve('playwright');
  } catch {
    return 'playwright not installed (production/omit-dev install)';
  }

  return null;
}

const skipReason = shouldSkip();

if (skipReason) {
  console.log(`[postinstall] Skipping Playwright browser download: ${skipReason}`);
  process.exit(0);
}

const { spawnSync } = require('child_process');

console.log('[postinstall] Installing Playwright Chromium for the dev browser...');
const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  // Never fail the whole `npm install` over this — the dev browser is a
  // convenience, not a hard requirement. dev-with-browser.js already
  // catches launch failures gracefully and just skips opening the window.
  console.warn(
    '[postinstall] Playwright Chromium install failed or was skipped. ' +
      'Run `npx playwright install chromium` manually if you want the auto-opening dev browser.'
  );
}

process.exit(0);
