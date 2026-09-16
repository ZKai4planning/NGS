import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "@/components/UserMenu";

// This layout wraps every page under app/(dashboard)/ — projects, etc.
// It does NOT wrap /login, /forgot-password, or /reset-password, which
// sit outside this route group and render full-bleed with no header.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/projects" className="brand" style={{ textDecoration: "none", color: "var(--ink)" }}>
          <img src="/ngslogo.png" alt="Norfolk Glazing Solutions" className="brand-logo" />
        </Link>
        {user && user.email && (
          <div className="header-actions">
            <UserMenu email={user.email} />
          </div>
        )}
      </header>
      {children}
    </div>
  );
}
