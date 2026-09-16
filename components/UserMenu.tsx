"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface UserMenuProps {
  email: string;
}

// Stable, deterministic initials from an email's local part -- "pavan.kumar_ext"
// -> "PK". Falls back to the first two characters if there's nothing to split on.
function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

/**
 * Replaces the always-visible "Settings / email / Sign out" row with a
 * single avatar button that opens a dropdown -- the same actions, just
 * tucked behind one click instead of permanently taking up header space.
 */
export function UserMenu({ email }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 999,
          padding: "5px 12px 5px 5px",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "var(--ink)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initialsFromEmail(email)}
        </span>
        <span
          style={{
            fontSize: 13,
            color: "var(--ink)",
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {email}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s", flexShrink: 0 }}
        >
          <path d="M6 9l6 6 6-6" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: 220,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(28,36,48,0.12)",
            overflow: "hidden",
            zIndex: 50,
          }}
        >
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
            <div className="helptext" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>
              Signed in as
            </div>
            <div style={{ fontSize: 13, color: "var(--ink)", wordBreak: "break-all", marginTop: 2 }}>{email}</div>
          </div>

          <MenuLink href="/settings/profile" onClick={() => setOpen(false)}>
            Profile
          </MenuLink>
          <MenuLink href="/settings/integrations" onClick={() => setOpen(false)}>
            Integrations
          </MenuLink>

          <a
            href="/api/auth/signout"
            style={{
              display: "block",
              padding: "10px 14px",
              fontSize: 13,
              color: "var(--red)",
              textDecoration: "none",
              borderTop: "1px solid var(--line)",
            }}
          >
            Sign out
          </a>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{
        display: "block",
        padding: "10px 14px",
        fontSize: 13,
        color: "var(--ink)",
        textDecoration: "none",
      }}
      role="menuitem"
    >
      {children}
    </Link>
  );
}
