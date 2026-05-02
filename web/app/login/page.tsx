import { redirect } from "next/navigation";

// /login is an alias for the canonical /auth/login route. This redirect exists
// so external links / bookmarks / muscle memory to /login don't 404.
export default function LoginRedirectPage() {
  redirect("/auth/login");
}
