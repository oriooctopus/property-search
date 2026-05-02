import Link from "next/link";

export default function FavoritesPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold" style={{ color: "#e1e4e8" }}>
        Favorites moved to Wishlists
      </h1>
      <p className="mt-3 text-sm" style={{ color: "#8b949e" }}>
        We replaced Favorites with Wishlists — you can now organize saved
        listings into multiple named lists and share them.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
        style={{ backgroundColor: "#58a6ff", color: "#0f1117" }}
      >
        Open Wishlists
      </Link>
    </div>
  );
}
