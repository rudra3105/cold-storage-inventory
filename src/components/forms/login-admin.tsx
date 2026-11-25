"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-utils";
import { Field, FormError, FormSuccess } from "./field";
import { SubmitButton } from "./submit-button";

/** Create a login (email + password) or reset a password. The server action does the privileged work. */
export function CredentialForm({ mode, defaultEmail, action, submitLabel }: {
  mode: "create" | "reset"; defaultEmail?: string; submitLabel: string;
  action: (email: string, password: string) => Promise<ActionResult<unknown>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  const gen = () => { const a = new Uint32Array(4); crypto.getRandomValues(a); setPassword(Array.from(a, (n) => n.toString(36)).join("").slice(0, 14) + "A1!"); };
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => {
      setError(null); setDone(false);
      const r = await action(email, password);
      if (!r.ok) return setError(r.error);
      setDone(true); router.refresh();
    }); }}>
      {mode === "create" && <Field label="Login email" htmlFor="login-email"><Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></Field>}
      <Field label={mode === "create" ? "Initial password" : "New password"} htmlFor="login-pw" hint="At least 10 characters. Share it with the customer securely.">
        <div className="flex gap-2">
          <Input id="login-pw" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="off" />
          <Button type="button" variant="outline" onClick={gen}>Generate</Button>
        </div>
      </Field>
      <FormError message={error} /><FormSuccess message={done ? (mode === "create" ? "Login created. Note the password now — it is not shown again." : "Password updated. Note it now — it is not shown again.") : null} />
      <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
    </form>
  );
}
