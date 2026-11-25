"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { login, type LoginState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" required aria-invalid={!!state.error} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.error} />
      </div>
      {state.error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-destructive">{state.error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Sign in
      </Button>
    </form>
  );
}
