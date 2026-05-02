import type { Metadata } from "next";
import { createClient } from "@/lib/supabase-server";
import HomeClient from "@/components/HomeClient";

type SearchParams = Record<string, string | string[] | undefined>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_METADATA: Metadata = {
  title: "Dwelligence",
  description: "AI-powered NYC apartment search",
  openGraph: {
    title: "Dwelligence",
    description: "AI-powered NYC apartment search",
    type: "website",
    siteName: "Dwelligence",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dwelligence",
    description: "AI-powered NYC apartment search",
  },
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  const raw = params?.wishlist;
  const wishlistId = Array.isArray(raw) ? raw[0] : raw;

  if (!wishlistId || !UUID_RE.test(wishlistId)) {
    return DEFAULT_METADATA;
  }

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("wishlists")
      .select("name, wishlist_items(listing_id)")
      .eq("id", wishlistId)
      .maybeSingle();

    if (!data?.name) return DEFAULT_METADATA;

    const name = data.name;
    const count = Array.isArray(
      (data as { wishlist_items?: unknown }).wishlist_items,
    )
      ? (data as { wishlist_items: unknown[] }).wishlist_items.length
      : 0;
    const title = `${name} — Dwelligence Wishlist`;
    const ogTitle = `${name} on Dwelligence`;
    const description =
      count > 0
        ? `View ${count} apartment${count === 1 ? "" : "s"} saved on Dwelligence`
        : `View this wishlist on Dwelligence`;

    return {
      title,
      description,
      openGraph: {
        title: ogTitle,
        description,
        type: "website",
        siteName: "Dwelligence",
      },
      twitter: {
        card: "summary_large_image",
        title: ogTitle,
        description,
      },
    };
  } catch {
    return DEFAULT_METADATA;
  }
}

export default function Page() {
  return <HomeClient />;
}
