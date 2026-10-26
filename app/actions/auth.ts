// src/app/actions/auth.ts
"use server";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const SECRET_KEY = new TextEncoder().encode(process.env.SESSION_SECRET_KEY || "fallback-secret-key");

