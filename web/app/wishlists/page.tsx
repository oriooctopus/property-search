import { redirect } from "next/navigation";

// /wishlists is not a standalone page — wishlists are managed via the
// "Manage wishlists..." modal anchored to the home page. This route exists
// so external links / bookmarks to /wishlists land on the home page with the
// modal auto-opened, instead of returning a 404.
export default function WishlistsRedirectPage() {
  redirect("/?manageWishlists=1");
}
