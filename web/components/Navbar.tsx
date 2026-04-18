"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { PrimaryButton } from "@/components/ui";
import { useProfile } from "@/lib/hooks/useProfile";
import type { User } from "@supabase/supabase-js";

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const { data: profile, isLoading: profileLoading } = useProfile(user?.id ?? null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    router.push("/");
    router.refresh();
  };

  const avatarLetter = user?.email?.charAt(0).toUpperCase() ?? "?";
  const avatarUrl = profile?.avatar_url;

  return (
    <nav
      className="relative lg:fixed top-0 left-0 right-0 z-[1200] flex items-center justify-between px-3 sm:px-6"
      style={{
        backgroundColor: "#0f1117",
        borderBottom: "1px solid #2d333b",
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(60px + env(safe-area-inset-top))",
      }}
    >
      <Link
        href="/"
        className="group flex items-center gap-2 text-base sm:text-lg font-semibold transition-opacity hover:opacity-80 flex-shrink-0"
        style={{ color: "#e1e4e8" }}
      >
        <span className="relative inline-flex items-center justify-center" style={{ width: 30, height: 30 }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 48 48"
            fill="none"
            width={30}
            height={30}
            aria-hidden="true"
            className="relative z-10"
          >
            <rect x="3" y="3" width="42" height="42" rx="8" stroke="#ffffff" strokeWidth="2" fill="none" />
            <rect x="9" y="9" width="30" height="30" rx="5" stroke="#ffffff" strokeWidth="1.2" fill="none" opacity="0.55" />
            <rect x="15" y="15" width="18" height="18" rx="3" stroke="#ffffff" strokeWidth="1.2" fill="none" opacity="0.35" />
            <circle cx="35" cy="13" r="1.3" fill="#ffffff" opacity="0.7" />
            <circle cx="13" cy="34" r="1" fill="#ffffff" opacity="0.5" />
            <path d="M24 18 L19 23 L29 23 Z" fill="#ffffff" />
            <rect x="20" y="23" width="8" height="6" fill="#ffffff" />
            <rect x="26.5" y="19" width="1.8" height="4" fill="#ffffff" />
          </svg>
          {/* Orbiting dots — visible only on hover via group-hover */}
          {[
            { radius: 17, duration: 0.8, delay: 0, size: 2.5, opacity: 0.9 },
            { radius: 20, duration: 1.0, delay: 0.1, size: 2, opacity: 0.7 },
            { radius: 19, duration: 1.2, delay: 0.3, size: 2, opacity: 0.55 },
          ].map((dot, i) => (
            <span
              key={i}
              className="pointer-events-none absolute top-1/2 left-1/2 hidden group-hover:block"
              style={{
                width: 0,
                height: 0,
                animation: `navOrbit ${dot.duration}s linear ${dot.delay}s infinite`,
              }}
            >
              <span
                className="absolute block rounded-full"
                style={{
                  top: -dot.radius - dot.size / 2,
                  left: -dot.size / 2,
                  width: dot.size,
                  height: dot.size,
                  backgroundColor: '#58a6ff',
                  opacity: dot.opacity,
                  boxShadow: `0 0 ${dot.size * 2}px rgba(88,166,255,${dot.opacity * 0.6})`,
                }}
              />
            </span>
          ))}
          <style>{`
            @keyframes navOrbit {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </span>
        Dwelligence
      </Link>

      <div className="flex items-center gap-2 sm:gap-4 flex-shrink min-w-0">
        {loading ? (
          <div className="h-8 w-8" />
        ) : user ? (
          <>
            <div className="relative" ref={dropdownRef}>
              {profileLoading ? (
                <div className="h-8 w-8 rounded-full" style={{ backgroundColor: "#2d333b" }} />
              ) : (
              <button
                onClick={() => setDropdownOpen((prev) => !prev)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-opacity hover:opacity-80 cursor-pointer overflow-hidden"
                style={{ backgroundColor: "#58a6ff", color: "#0f1117" }}
                title={user.email ?? ""}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Avatar"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  avatarLetter
                )}
              </button>
              )}
              {dropdownOpen && (
                <div
                  className="absolute right-0 mt-2 w-40 rounded-md py-1 shadow-lg"
                  style={{
                    backgroundColor: "#1c2028",
                    border: "1px solid #2d333b",
                  }}
                >
                  <Link
                    href="/profile"
                    onClick={() => setDropdownOpen(false)}
                    className="block w-full px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
                    style={{ color: "#e1e4e8" }}
                  >
                    Profile
                  </Link>
                  <Link
                    href="/wishlists"
                    onClick={() => setDropdownOpen(false)}
                    className="block w-full px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
                    style={{ color: "#e1e4e8" }}
                  >
                    Wishlists
                  </Link>
                  <Link
                    href="/hidden"
                    onClick={() => setDropdownOpen(false)}
                    className="block w-full px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
                    style={{ color: "#e1e4e8" }}
                  >
                    Hidden
                  </Link>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      router.push("/?tour=1");
                    }}
                    className="block w-full px-4 py-2 text-left text-sm transition-colors hover:opacity-80 cursor-pointer"
                    style={{ color: "#8b949e" }}
                  >
                    Take a tour
                  </button>
                  <div style={{ borderTop: "1px solid #2d333b", margin: "4px 0" }} />
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      handleLogout();
                    }}
                    className="block w-full px-4 py-2 text-left text-sm transition-colors hover:opacity-80 cursor-pointer"
                    style={{ color: "#e1e4e8" }}
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <PrimaryButton
              onClick={() => router.push("/auth/login")}
              className="rounded-md px-2 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm"
            >
              Log in
            </PrimaryButton>
            <Link
              href="/auth/signup"
              className="hidden sm:inline text-sm transition-colors hover:opacity-80"
              style={{ color: "#8b949e" }}
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
