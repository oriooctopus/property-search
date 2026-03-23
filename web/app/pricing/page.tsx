"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

interface TierInfo {
  id: string;
  name: string;
  monthly_query_limit: number;
  price_monthly: number;
  features: Record<string, boolean>;
}

export default function PricingPage() {
  const [tiers, setTiers] = useState<TierInfo[]>([]);
  const [currentTier, setCurrentTier] = useState<string>("free");
  const [toast, setToast] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: tierData } = await supabase
        .from("pricing_tiers")
        .select("id, name, monthly_query_limit, price_monthly, features")
        .order("price_monthly", { ascending: true });

      if (tierData) setTiers(tierData as TierInfo[]);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: userTier } = await supabase
          .from("user_tiers")
          .select("tier_id")
          .eq("user_id", user.id)
          .single();

        if (userTier) setCurrentTier(userTier.tier_id);
      }
    }

    load();
  }, [supabase]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const tierDescriptions: Record<string, string> = {
    free: "Get started with basic property searches",
    pro: "More searches and advanced filtering for serious buyers",
    enterprise: "Unlimited access for teams and professionals",
  };

  const tierHighlights: Record<string, string[]> = {
    free: ["5 searches per month", "Basic filters", "View listing details"],
    pro: [
      "50 searches per month",
      "Advanced filters",
      "Export results",
      "Priority results",
    ],
    enterprise: [
      "Unlimited searches",
      "API access",
      "Priority support",
      "Team management",
      "Custom integrations",
    ],
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold" style={{ color: "#e1e4e8" }}>
          Pricing Plans
        </h1>
        <p className="mt-2 text-sm" style={{ color: "#8b949e" }}>
          Choose the plan that fits your property search needs
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiers.map((tier) => {
          const isCurrent = tier.id === currentTier;
          const isPopular = tier.id === "pro";

          return (
            <div
              key={tier.id}
              className="relative rounded-lg p-6 flex flex-col"
              style={{
                backgroundColor: "#1c2028",
                border: `1px solid ${isPopular ? "#58a6ff" : "#2d333b"}`,
              }}
            >
              {isPopular && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: "#58a6ff", color: "#0f1117" }}
                >
                  Most Popular
                </div>
              )}

              {isCurrent && (
                <div
                  className="absolute top-3 right-3 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    backgroundColor: "#7ee78720",
                    color: "#7ee787",
                    border: "1px solid #7ee78740",
                  }}
                >
                  Current plan
                </div>
              )}

              <div className="mb-4">
                <h2
                  className="text-lg font-bold"
                  style={{ color: "#e1e4e8" }}
                >
                  {tier.name}
                </h2>
                <p
                  className="text-xs mt-1"
                  style={{ color: "#8b949e" }}
                >
                  {tierDescriptions[tier.id] ?? ""}
                </p>
              </div>

              <div className="mb-6">
                <span
                  className="text-3xl font-bold"
                  style={{ color: "#e1e4e8" }}
                >
                  ${(tier.price_monthly / 100).toFixed(0)}
                </span>
                <span className="text-sm" style={{ color: "#8b949e" }}>
                  /month
                </span>
              </div>

              <ul className="mb-6 space-y-2 flex-1">
                {(tierHighlights[tier.id] ?? []).map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-2 text-sm"
                    style={{ color: "#8b949e" }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#7ee787"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              {tier.id === "free" ? (
                <button
                  disabled
                  className="w-full rounded-md px-4 py-2.5 text-sm font-medium opacity-50 cursor-not-allowed"
                  style={{
                    backgroundColor: "#2d333b",
                    color: "#8b949e",
                  }}
                >
                  {isCurrent ? "Current plan" : "Free"}
                </button>
              ) : tier.id === "enterprise" ? (
                <button
                  onClick={() => showToast("Coming soon! Contact us at hello@dwelligence.com")}
                  className="w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors hover:opacity-90"
                  style={{
                    backgroundColor: "transparent",
                    color: "#58a6ff",
                    border: "1px solid #58a6ff",
                  }}
                >
                  Contact us
                </button>
              ) : (
                <button
                  onClick={() => showToast("Payment processing coming soon!")}
                  className="w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors hover:opacity-90"
                  style={{ backgroundColor: "#58a6ff", color: "#0f1117" }}
                >
                  {isCurrent ? "Current plan" : "Upgrade"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg px-6 py-3 text-sm font-medium shadow-lg transition-all"
          style={{
            backgroundColor: "#1c2028",
            border: "1px solid #2d333b",
            color: "#e1e4e8",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
