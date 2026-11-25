"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-utils";
import { FormError } from "./field";

/**
 * Button that runs a server action after confirmation. With `askReason` it collects a mandatory reason
 * (used for cancellations, which must be audited). Never optimistic: the UI refreshes from the server.
 */
export function ConfirmAction({
  label, confirmText, action, askReason = false, variant = "outline", size = "sm", onDoneHref, icon,
}: {
  label: string; confirmText: string; action: (reason: string) => Promise<ActionResult<unknown>>;
  askReason?: boolean; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; onDoneHref?: string; icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!open) return <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>{icon}{label}</Button>;
  return (
    <div className="flex w-full max-w-md flex-col gap-2 rounded-xl border bg-card p-4">
      <p className="text-base">{confirmText}</p>
      {askReason && <Input autoFocus placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />}
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={variant === "outline" ? "destructive" : variant} disabled={pending || (askReason && reason.trim().length < 3)}
          onClick={() => start(async () => {
            const r = await action(reason.trim());
            if (!r.ok) { setError(r.error); return; }
            setOpen(false); setError(null);
            if (onDoneHref) router.push(onDoneHref); else router.refresh();
          })}>
          {pending && <Loader2 className="animate-spin" />} Confirm
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Back</Button>
      </div>
    </div>
  );
}
