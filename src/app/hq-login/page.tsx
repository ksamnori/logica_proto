// src/app/hq-login/page.tsx
import { redirect } from "next/navigation";

export default function LegacyHqLoginRedirect() {
  redirect("/hq/login");
}
