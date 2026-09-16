// scripts/localhost-browser.js
//
// Ephemeral, localhost-only browser window (Playwright).
// - Non-persistent context => cache/cookies/storage live only for the
//   life of the process; wiped automatically on close.
// - Blocks NAVIGATION (address bar / link clicks / redirects) to anything
//   that isn't localhost/127.0.0.1. Does NOT block subresource requests
//   (fetch/XHR/websocket) — the app running on localhost is expected to
//   call external APIs (Supabase, Upstash, etc.); only the browser window
//   itself is restricted to localhost pages.
// - Launches maximized, filling the screen.
//
// Exposes launchLocalhostBrowser(url) so it can be driven by other
// scripts (e.g. scripts/dev-with-browser.js) instead of run standalone.

const { chromium } = require('playwright');

const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function isAllowed(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return ALLOWED_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

async function launchLocalhostBrowser(startUrl) {
  if (!isAllowed(startUrl)) {
    throw new Error(`Refusing to launch: "${startUrl}" is not a localhost URL.`);
  }

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });
  // viewport: null => page fills whatever size the (maximized) window is,
  // instead of Playwright forcing a fixed default viewport inside it.
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  await context.route('**/*', (route) => {
    const request = route.request();
    const url = request.url();
    // Only gate navigations (top-level page loads / address-bar entries /
    // link clicks / redirects to a full page). Subresource calls the app
    // itself makes — fetch, XHR, websocket, images, fonts, etc. — are
    // always allowed, since blocking those breaks any app that talks to
    // an external API or CDN, which is basically all of them.
    if (!request.isNavigationRequest() || isAllowed(url) || url.startsWith('data:') || url.startsWith('about:')) {
      route.continue();
    } else {
      console.warn(`[dev-browser] Blocked non-localhost navigation: ${url}`);
      route.abort();
    }
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && !isAllowed(frame.url()) && !frame.url().startsWith('about:')) {
      console.warn(`[dev-browser] Blocked top-frame navigation to: ${frame.url()}`);
      page.goBack().catch(() => {});
    }
  });

  await page.goto(startUrl);
  console.log(`[dev-browser] Ephemeral browser open at ${startUrl}`);

  const closeListeners = [];
  const notifyClose = () => closeListeners.forEach((fn) => fn());
  context.on('close', notifyClose);
  browser.on('disconnected', notifyClose);

  return {
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
    onClose: (fn) => closeListeners.push(fn),
  };
}

module.exports = { launchLocalhostBrowser };