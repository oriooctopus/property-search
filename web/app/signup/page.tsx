import { redirect } from "next/navigation";

// /signup is an alias for the canonical /auth/signup route. This redirect
// exists so external links / bookmarks / muscle memory to /signup don't 404.
export default function SignupRedirectPage() {
  redirect("/auth/signup");
}
