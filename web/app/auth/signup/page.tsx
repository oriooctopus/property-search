"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { PrimaryButton } from "@/components/ui";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // If email confirmation is required, the session will be null
    if (data.session) {
      // Auto-confirmed — go straight to profile
      router.push("/profile?setup=true");
      router.refresh();
    } else {
      // Confirmation email sent — show message
      setConfirmSent(true);
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: "#0f1117" }}
    >
      <div
        className="w-full max-w-md rounded-lg p-8"
        style={{
          backgroundColor: "#1c2028",
          border: "1px solid #2d333b",
        }}
      >
        {confirmSent ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-4">📧</div>
            <h1 className="text-xl font-semibold mb-2" style={{ color: "#e1e4e8" }}>
              Check your email
            </h1>
            <p className="text-sm mb-4" style={{ color: "#8b949e" }}>
              We sent a confirmation link to <strong style={{ color: "#e1e4e8" }}>{email}</strong>.
              Click the link to activate your account.
            </p>
            <Link
              href="/auth/login"
              className="text-sm hover:underline"
              style={{ color: "#58a6ff" }}
            >
              Go to login →
            </Link>
          </div>
        ) : (
        <>
        <h1
          className="mb-6 text-center text-2xl font-semibold"
          style={{ color: "#e1e4e8" }}
        >
          Sign up
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-xs text-[#8b949e]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs text-[#8b949e]"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
              placeholder="At least 6 characters"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "#f85149" }}>
              {error}
            </p>
          )}

          <PrimaryButton
            type="submit"
            variant="green"
            disabled={loading}
            loading={loading}
            fullWidth
            className="mt-2 rounded-md py-2"
          >
            Sign up
          </PrimaryButton>
        </form>

        <p
          className="mt-6 text-center text-sm"
          style={{ color: "#8b949e" }}
        >
          Already have an account?{" "}
          <Link
            href="/auth/login"
            className="hover:underline"
            style={{ color: "#58a6ff" }}
          >
            Log in
          </Link>
        </p>
        </>
        )}
      </div>
    </div>
  );
}
