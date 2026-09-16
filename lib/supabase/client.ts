import { createBrowserClient } from "@supabase/ssr";

// rememberSession=true (default) persists the session in localStorage, so
// it survives browser restarts. rememberSession=false keeps it in
// sessionStorage instead, so it clears when the tab/browser closes —
// that's what the login screen's "Remember me" checkbox controls.
export function createClient(options?: { rememberSession?: boolean }) {
  const remember = options?.rememberSession ?? true;

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storage: !remember && typeof window !== "undefined" ? window.sessionStorage : undefined,
      },
    }
  );
}
