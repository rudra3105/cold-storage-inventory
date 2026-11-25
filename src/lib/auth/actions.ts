"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string };

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(200),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { error: "Incorrect email or password" };      // no account enumeration

  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    supabase.from("profiles").select("is_active").eq("id", data.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle(),
  ]);
  if (!profile?.is_active || !roleRow) {
    await supabase.auth.signOut();
    return { error: "This account is disabled or has no access. Contact the warehouse office." };
  }
  redirect(roleRow.role === "customer" ? "/portal" : "/admin");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
