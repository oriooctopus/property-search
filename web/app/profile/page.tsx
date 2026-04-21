"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase-browser";
import { PROFILE_QUERY_KEY } from "@/lib/hooks/useProfile";
import type { Database } from "@/lib/types";
import { PrimaryButton, TextButton } from "@/components/ui";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

function ProfileInner() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSetupMode = searchParams.get("setup") === "true";

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Load user and profile on mount
  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/auth/login");
        return;
      }

      setUserId(user.id);

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single<Database["public"]["Tables"]["profiles"]["Row"]>();

      if (data) {
        setDisplayName(data.display_name ?? "");
        setBio(data.bio ?? "");
        setPhone(data.phone ?? "");
        setAvatarUrl(data.avatar_url);
      }

      setLoading(false);
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    if (!userId) return;
    setSaving(true);

    try {
      let newAvatarUrl = avatarUrl;

      // Upload avatar if a new file was selected
      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop() ?? "png";
        const path = `${userId}/avatar.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true });

        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from("avatars").getPublicUrl(path);

        newAvatarUrl = publicUrl;
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName || null,
          bio: bio || null,
          phone: phone || null,
          avatar_url: newAvatarUrl,
        })
        .eq("id", userId);

      if (error) throw error;

      setAvatarUrl(newAvatarUrl);
      setAvatarFile(null);
      setAvatarPreview(null);

      // Invalidate the profile query so the navbar avatar updates immediately
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });

      if (isSetupMode) {
        router.push("/?tour=1");
      } else {
        setToast({ message: "Profile saved successfully.", type: "success" });
      }
    } catch (err: unknown) {
      console.error("Profile save error:", err);
      let message = "Failed to save profile.";
      if (err && typeof err === "object" && "message" in err) {
        message = (err as { message: string }).message;
      }
      setToast({ message, type: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1117]">
        <p className="text-[#8b949e]">Loading...</p>
      </div>
    );
  }

  const shownAvatar = avatarPreview ?? avatarUrl;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1117] px-4 py-12">
      <div className="w-full max-w-lg rounded-xl border border-[#2d333b] bg-[#1c2028] p-8 shadow-lg">
        {isSetupMode ? (
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-[#e1e4e8]">
              Welcome!
            </h1>
            <p className="mt-2 text-sm text-[#8b949e]">
              Set up your profile so others can see who you are.
            </p>
          </div>
        ) : (
          <h1 className="mb-8 text-2xl font-semibold text-[#e1e4e8]">
            Your Profile
          </h1>
        )}

        {/* Avatar */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group relative h-32 w-32 overflow-hidden rounded-full border-2 border-[#2d333b] transition hover:border-[#58a6ff] cursor-pointer"
          >
            {shownAvatar ? (
              <Image
                src={shownAvatar}
                alt="Avatar"
                width={128}
                height={128}
                sizes="128px"
                quality={85}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#0f1117] text-[#8b949e]">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-10 w-10"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                  />
                </svg>
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
              <span className="text-sm font-medium text-white">Change</span>
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarSelect}
          />
          <p className="text-xs text-[#8b949e]">Click to upload avatar</p>
        </div>

        {/* Form fields */}
        <div className="space-y-5">
          <div>
            <label
              htmlFor="displayName"
              className="mb-1.5 block text-xs text-[#8b949e]"
            >
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
              placeholder="Your name"
            />
          </div>

          <div>
            <label
              htmlFor="bio"
              className="mb-1.5 block text-xs text-[#8b949e]"
            >
              Bio
            </label>
            <textarea
              id="bio"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full resize-none rounded-md border border-[#2d333b] bg-[#0f1117] px-3 py-2 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
              placeholder="Tell us about yourself"
            />
          </div>

          <div>
            <label
              htmlFor="phone"
              className="mb-1.5 block text-xs text-[#8b949e]"
            >
              Phone Number
            </label>
            <input
              id="phone"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={`w-full rounded-md border bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff] ${
                isSetupMode
                  ? "h-11 border-[#3d434b] text-base"
                  : "h-9 border-[#2d333b]"
              }`}
              placeholder="+1 (555) 123-4567"
            />
            {isSetupMode && (
              <p className="mt-1.5 text-xs text-[#8b949e]">
                Add your phone number to get notified via SMS when new listings
                match your search criteria.
              </p>
            )}
          </div>
        </div>

        {/* Save / Complete Setup button */}
        <PrimaryButton
          onClick={handleSave}
          disabled={saving}
          loading={saving}
          variant={isSetupMode ? "green" : "accent"}
          fullWidth
          className="mt-8"
        >
          {isSetupMode ? "Complete Setup" : "Save Profile"}
        </PrimaryButton>

        {isSetupMode && (
          <TextButton
            variant="muted"
            onClick={() => router.push("/?tour=1")}
            className="mt-3 w-full rounded-lg px-4 py-2"
          >
            Skip for now
          </TextButton>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 rounded-lg border px-5 py-3 text-sm shadow-lg transition ${
            toast.type === "success"
              ? "border-green-700 bg-green-900/80 text-green-200"
              : "border-red-700 bg-red-900/80 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileInner />
    </Suspense>
  );
}
