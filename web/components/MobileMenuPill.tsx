"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useProfile } from "@/lib/hooks/useProfile";

/**
 * Merged "Filters | Avatar" pill that lives top-right on mobile (Option C).
 *
 * Replaces the standalone floating "Filters" pill that previously lived inside
 * SwipeView. Renders on mobile (<600px) in BOTH swipe view and list/map views
 * because the global Navbar is hidden on mobile when this pill is mounted —
 * so the avatar half is the only path to Profile / wishlists / sign-out on
 * the small viewport.
 *
 * Two adjacent tap targets separated by a 1px vertical divider:
 *   - Filter half (left): icon + "Filters" label, opens the existing mobile
 *     filters sheet via `onOpenFilters`.
 *   - Avatar half (right): user's first-name initial (or email initial),
 *     opens an account dropdown anchored under the pill. Logged-out state
 *     replaces the avatar with a "Log in" link to /auth/login.
 *
 * Each half is ≥40px wide for thumb-friendly hit area. aria-labels disambiguate.
 *
 * Desktop (≥600px) renders nothing — the global Navbar handles account UI
 * there and the sidebar Filters bar handles filter chips/sheet.
 */
export interface MobileMenuPillProps {
  userId: string | null;
  userEmail: string | null;
  /** Called when the user taps the filter half — opens the mobile filter sheet. */
  onOpenFilters: () => void;
  /** Opens the manage-wishlists modal in-page (instead of routing). */
  onOpenManageWishlists: () => void;
}

export default function MobileMenuPill({
  userId,
  userEmail,
  onOpenFilters,
  onOpenManageWishlists,
}: MobileMenuPillProps) {
  const router = useRouter();
  const supabase = createClient();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: profile } = useProfile(userId);
  const avatarUrl = profile?.avatar_url ?? null;
  const avatarLetter = (userEmail?.charAt(0) ?? "?").toUpperCase();

  // Click-outside / Escape to close the dropdown.
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [dropdownOpen]);

  const handleLogout = async () => {
    setDropdownOpen(false);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <div
      ref={containerRef}
      className="absolute min-[600px]:hidden"
      style={{
        top: "calc(env(safe-area-inset-top) + 12px)",
        right: 14,
        zIndex: 1250, // above the swipe map (z-20) and the global Navbar (z-1200)
      }}
      data-testid="mobile-menu-pill"
    >
      {/* Merged pill */}
      <div
        style={{
          height: 44,
          background: "rgba(28,32,40,0.88)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 9999,
          boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        {/* Filter half */}
        <button
          type="button"
          onClick={onOpenFilters}
          className="cursor-pointer transition-colors duration-150"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 14px",
            height: "100%",
            minWidth: 40,
            background: "transparent",
            border: "none",
            color: "#c9d1d9",
            fontSize: 12,
            fontWeight: 500,
            borderRight: "1px solid rgba(255,255,255,0.1)",
          }}
          aria-label="Open filters"
          title="Filters"
          data-testid="mobile-menu-pill-filters"
          data-tour="filters-mobile"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2.5" strokeLinecap="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="11" y1="18" x2="13" y2="18" />
          </svg>
          Filters
        </button>

        {/* Avatar / Log-in half */}
        {userId ? (
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="cursor-pointer transition-colors duration-150"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 14px",
              height: "100%",
              minWidth: 48,
              background: dropdownOpen ? "rgba(88,166,255,0.1)" : "transparent",
              border: "none",
            }}
            aria-label="Open account menu"
            aria-expanded={dropdownOpen}
            aria-haspopup="menu"
            title={userEmail ?? "Account"}
            data-testid="mobile-menu-pill-avatar"
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "#58a6ff",
                color: "#0f1117",
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt="Avatar"
                  width={26}
                  height={26}
                  sizes="26px"
                  quality={80}
                  className="h-full w-full object-cover"
                />
              ) : (
                avatarLetter
              )}
            </span>
          </button>
        ) : (
          <Link
            href="/auth/login"
            className="cursor-pointer transition-colors duration-150"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "0 14px",
              height: "100%",
              minWidth: 48,
              color: "#58a6ff",
              fontSize: 11,
              fontWeight: 500,
              textDecoration: "none",
            }}
            aria-label="Log in"
            data-testid="mobile-menu-pill-login"
          >
            Log in
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
          </Link>
        )}
      </div>

      {/* Account dropdown (logged-in only) */}
      {dropdownOpen && userId && (
        <div
          role="menu"
          className="absolute"
          style={{
            top: 52,
            right: 0,
            width: 220,
            background: "#1c2028",
            border: "1px solid #2d333b",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.7)",
            zIndex: 1260,
            overflow: "hidden",
          }}
          data-testid="mobile-menu-pill-dropdown"
        >
          {/* Header with email */}
          <div
            style={{
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderBottom: "1px solid #2d333b",
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "#58a6ff",
                color: "#0f1117",
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt="Avatar"
                  width={30}
                  height={30}
                  sizes="30px"
                  quality={80}
                  className="h-full w-full object-cover"
                />
              ) : (
                avatarLetter
              )}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#e1e4e8",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {userEmail ?? "Signed in"}
              </div>
              <div style={{ fontSize: 10, color: "#8b949e" }}>Signed in</div>
            </div>
          </div>

          <Link
            href="/profile"
            onClick={() => setDropdownOpen(false)}
            role="menuitem"
            className="block w-full text-left transition-colors hover:opacity-80"
            style={{
              padding: "11px 16px",
              fontSize: 13,
              color: "#e1e4e8",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              textDecoration: "none",
            }}
          >
            Profile
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDropdownOpen(false);
              onOpenManageWishlists();
            }}
            className="block w-full text-left transition-colors hover:opacity-80 cursor-pointer"
            style={{
              padding: "11px 16px",
              fontSize: 13,
              color: "#e1e4e8",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              background: "transparent",
              border: "none",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
            }}
          >
            Manage wishlists...
          </button>

          <Link
            href="/hidden"
            onClick={() => setDropdownOpen(false)}
            role="menuitem"
            className="block w-full text-left transition-colors hover:opacity-80"
            style={{
              padding: "11px 16px",
              fontSize: 13,
              color: "#e1e4e8",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              textDecoration: "none",
            }}
          >
            Hidden listings
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDropdownOpen(false);
              router.push("/?tour=1");
            }}
            className="block w-full text-left transition-colors hover:opacity-80 cursor-pointer"
            style={{
              padding: "11px 16px",
              fontSize: 13,
              color: "#8b949e",
              background: "transparent",
              border: "none",
            }}
          >
            Take a tour
          </button>

          <div style={{ height: 1, background: "#2d333b", margin: "4px 0" }} />

          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="block w-full text-left transition-colors hover:opacity-80 cursor-pointer"
            style={{
              padding: "11px 16px",
              fontSize: 13,
              color: "#ff7b72",
              background: "transparent",
              border: "none",
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
