// src/app/parent/page.tsx
import { redirect } from "next/navigation";

export default function ParentRedirectPage() {
  // /parent 로 접속하면 즉시 서버 단에서 /p 로 강제 이동시킵니다.
  redirect("/p");
}