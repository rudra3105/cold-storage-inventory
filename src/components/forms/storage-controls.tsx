"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-utils";
import { FormError } from "./field";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) => start(async () => {
    setError(null);
    const r = await fn();
    if (!r.ok) return setError(r.error);
    after?.(); router.refresh();
  });
  return { pending, error, run };
}

export function AddRack({ floorId, add }: { floorId: string; add: (floorId: string, code: string, cap: number | null) => Promise<ActionResult<unknown>> }) {
  const { pending, error, run } = useRun();
  const [code, setCode] = useState(""); const [cap, setCap] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => add(floorId, code, cap ? Number(cap) : null), () => { setCode(""); setCap(""); }); }}>
      <Input aria-label="New rack code" placeholder="Rack code, e.g. R1" value={code} onChange={(e) => setCode(e.target.value)} className="h-9 w-36" required />
      <Input aria-label="Capacity in bags" placeholder="Capacity (bags)" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} className="h-9 w-36" />
      <Button type="submit" size="sm" disabled={pending}><Plus /> Add rack</Button>
      <FormError message={error} />
    </form>
  );
}

export function RackRow({ id, code, capacity, active, update, setActive }: {
  id: string; code: string; capacity: number | null; active: boolean;
  update: (id: string, code: string, cap: number | null) => Promise<ActionResult<unknown>>;
  setActive: (id: string, active: boolean) => Promise<ActionResult<unknown>>;
}) {
  const { pending, error, run } = useRun();
  const [edit, setEdit] = useState(false); const [c, setC] = useState(code); const [cap, setCap] = useState(capacity?.toString() ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      {edit ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => update(id, c, cap ? Number(cap) : null), () => setEdit(false)); }}>
          <Input value={c} onChange={(e) => setC(e.target.value)} className="h-8 w-28" aria-label="Rack code" required />
          <Input value={cap} onChange={(e) => setCap(e.target.value)} type="number" min={1} className="h-8 w-28" placeholder="Capacity" aria-label="Capacity" />
          <Button size="sm" type="submit" disabled={pending}>Save</Button><Button size="sm" type="button" variant="ghost" onClick={() => setEdit(false)}>Cancel</Button>
        </form>
      ) : (
        <>
          <span className={active ? "w-28 font-medium" : "w-28 text-muted-foreground line-through"}>{code}</span>
          <span className="w-32 text-sm text-muted-foreground">{capacity ? `${capacity.toLocaleString("en-IN")} bags cap.` : "no capacity set"}</span>
          <Button size="sm" variant="ghost" onClick={() => setEdit(true)} aria-label={`Edit rack ${code}`}><Pencil /></Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setActive(id, !active))}>{active ? "Deactivate" : "Activate"}</Button>
        </>
      )}
      <FormError message={error} />
    </div>
  );
}

export function SimpleAction({ label, run: fn, variant = "outline" }: { label: string; run: () => Promise<ActionResult<unknown>>; variant?: "outline" | "ghost" }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex flex-col gap-1"><Button size="sm" variant={variant} disabled={pending} onClick={() => run(fn)}>{label}</Button><FormError message={error} /></span>;
}

export function AddChamber({ add }: { add: (code: string, name: string) => Promise<ActionResult<unknown>> }) {
  const { pending, error, run } = useRun();
  const [code, setCode] = useState(""); const [name, setName] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => add(code, name || `Chamber ${code}`), () => { setCode(""); setName(""); }); }}>
      <Input aria-label="Chamber code" placeholder="Code, e.g. D" value={code} onChange={(e) => setCode(e.target.value)} className="h-9 w-28" required maxLength={10} />
      <Input aria-label="Chamber name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-44" />
      <Button type="submit" size="sm" disabled={pending}><Plus /> Add chamber</Button><FormError message={error} />
    </form>
  );
}
