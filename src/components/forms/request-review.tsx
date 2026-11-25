"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reviewRequestAction } from "@/lib/inventory-actions";
import { FormError } from "./field";

export function RequestReview({ id }: { id: string }) {
  const router = useRouter(); const [note, setNote] = useState(""); const [error, setError] = useState<string | null>(null); const [pending, start] = useTransition();
  const run = (approve: boolean) => start(async () => { setError(null); const r = await reviewRequestAction(id, approve, note); if (!r.ok) return setError(r.error); router.refresh(); });
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input aria-label="Note" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} className="h-9 sm:w-56" />
      <Button size="sm" disabled={pending} onClick={() => run(true)}>Approve</Button>
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(false)}>Reject</Button>
      <FormError message={error} />
    </div>
  );
}
