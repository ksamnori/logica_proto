// src/app/hq-signup/page.tsx
import { redirect } from "next/navigation";

export default function LegacyHqSignupRedirect() {
  redirect("/hq/signup");
}
