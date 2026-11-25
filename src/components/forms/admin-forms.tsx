"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { settingsSchema, staffSchema } from "@/lib/schemas";
import { changeStaffRole, createStaff, setRolePermission, updateSettings } from "@/lib/admin-actions";
import { addPartyRate, endPartyRate, saveChargeType, setChargeActive } from "@/lib/billing-actions";
import { resetLoginPassword, setLoginActive } from "@/app/(admin)/admin/parties/actions";
import type { ActionResult } from "@/lib/action-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FormError, FormSuccess } from "./field";
import { SubmitButton } from "./submit-button";

function useRun() {
  const router = useRouter(); const [pending, start] = useTransition(); const [error, setError] = useState<string | null>(null); const [okMsg, setOk] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, msg?: string, after?: () => void) => start(async () => { setError(null); setOk(null); const r = await fn(); if (!r.ok) return setError(r.error); if (msg) setOk(msg); after?.(); router.refresh(); });
  return { pending, error, okMsg, run };
}

type StaffV = z.infer<typeof staffSchema>;
export function StaffForm() {
  const { pending, error, okMsg, run } = useRun();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<StaffV>({ resolver: zodResolver(staffSchema), defaultValues: { full_name: "", phone: "", email: "", password: "" } as never });
  return (
    <Card><CardContent className="pt-5"><form noValidate onSubmit={handleSubmit((v) => run(() => createStaff(v), "Staff account created.", () => reset()))} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Full name *" error={errors.full_name?.message} htmlFor="sn"><Input id="sn" {...register("full_name")} /></Field>
      <Field label="Phone" htmlFor="sph"><Input id="sph" {...register("phone")} /></Field>
      <Field label="Role *" error={errors.role?.message} htmlFor="sr"><Select id="sr" {...register("role")}><option value="">Select…</option><option value="manager">Manager</option><option value="staff">Warehouse staff</option><option value="accountant">Accountant</option></Select></Field>
      <Field label="Email (login) *" error={errors.email?.message} htmlFor="se"><Input id="se" type="email" autoComplete="off" {...register("email")} /></Field>
      <Field label="Initial password *" error={errors.password?.message} htmlFor="spw" hint="Min 10 characters. Share it securely."><Input id="spw" type="password" autoComplete="new-password" {...register("password")} /></Field>
      <div className="flex flex-col justify-end gap-2"><FormError message={error} /><FormSuccess message={okMsg} /><SubmitButton pending={pending}>Create staff account</SubmitButton></div>
    </form></CardContent></Card>
  );
}

export function StaffRowActions({ userId, role, active, self, owner }: { userId: string; role: string; active: boolean; self: boolean; owner: boolean }) {
  const { pending, error, okMsg, run } = useRun(); const [pw, setPw] = useState("");
  if (owner || self) return <span className="text-sm text-muted-foreground">{self ? "You" : "Owner"}</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Role" defaultValue={role} className="h-8 w-36" disabled={pending} onChange={(e) => run(() => changeStaffRole(userId, e.target.value as "manager"), "Role updated.")}>
        <option value="manager">Manager</option><option value="staff">Warehouse staff</option><option value="accountant">Accountant</option></Select>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setLoginActive(userId, !active))}>{active ? "Deactivate" : "Activate"}</Button>
      <Input aria-label="New password" type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-8 w-36" autoComplete="new-password" />
      <Button size="sm" variant="outline" disabled={pending || pw.length < 10} onClick={() => run(() => resetLoginPassword(userId, pw), "Password reset.", () => setPw(""))}>Reset password</Button>
      <FormError message={error} /><FormSuccess message={okMsg} />
    </div>
  );
}

type SettingsV = z.infer<typeof settingsSchema>;
export function SettingsForm({ initial }: { initial: SettingsV }) {
  const { pending, error, okMsg, run } = useRun();
  const { register, handleSubmit, formState: { errors } } = useForm<SettingsV>({ resolver: zodResolver(settingsSchema), defaultValues: initial });
  return (
    <Card><CardContent className="pt-5"><form noValidate onSubmit={handleSubmit((v) => run(() => updateSettings(v), "Settings saved."))} className="grid gap-4 sm:grid-cols-2">
      <Field label="Business name *" error={errors.business_name?.message} htmlFor="bn"><Input id="bn" {...register("business_name")} /></Field>
      <Field label="GST number" htmlFor="bg"><Input id="bg" {...register("gst_number")} /></Field>
      <Field label="Phone" htmlFor="bp"><Input id="bp" {...register("phone")} /></Field>
      <Field label="Email" error={errors.email?.message} htmlFor="be"><Input id="be" type="email" {...register("email")} /></Field>
      <Field label="Address" className="sm:col-span-2" htmlFor="ba"><Textarea id="ba" rows={2} {...register("address")} /></Field>
      <Field label="Invoice terms (printed on invoices)" className="sm:col-span-2" htmlFor="bt"><Textarea id="bt" rows={3} {...register("invoice_terms")} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5 accent-[var(--primary)]" {...register("customer_can_see_rack")} /> Customers can see rack / floor location</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5 accent-[var(--primary)]" {...register("outward_requests_enabled")} /> Customers can submit outward requests</label>
      <div className="sm:col-span-2 space-y-2"><FormError message={error} /><FormSuccess message={okMsg} /><SubmitButton pending={pending}>Save settings</SubmitButton></div>
    </form></CardContent></Card>
  );
}

export function PermissionToggle({ role, permission, allowed }: { role: "manager" | "staff" | "accountant"; permission: string; allowed: boolean }) {
  const { pending, error, run } = useRun();
  return <><input type="checkbox" className="size-5 accent-[var(--primary)]" aria-label={`${role} ${permission}`} defaultChecked={allowed} disabled={pending} onChange={(e) => run(() => setRolePermission(role, permission, e.target.checked))} />{error && <span className="ml-1 text-sm font-medium text-destructive">{error}</span>}</>;
}

const CHARGE_BASIS = [["manual", "Manual entry"], ["flat", "Flat"], ["per_bag", "Per bag"], ["per_kg", "Per kg"], ["per_bag_per_day", "Per bag / day"], ["per_kg_per_day", "Per kg / day"], ["per_bag_per_month", "Per bag / month"], ["per_kg_per_month", "Per kg / month"]] as const;
export function ChargeTypeForm() {
  const { pending, error, run } = useRun(); const [code, setCode] = useState(""); const [name, setName] = useState(""); const [basis, setBasis] = useState("manual"); const [rate, setRate] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveChargeType(null, { code, name, basis: basis as never, default_rate: rate === "" ? null : Number(rate) }), undefined, () => { setCode(""); setName(""); setRate(""); }); }}>
      <Input aria-label="Code" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} className="h-9 w-28" required />
      <Input aria-label="Name" placeholder="Charge name" value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-48" required />
      <Select aria-label="Basis" value={basis} onChange={(e) => setBasis(e.target.value)} className="h-9 w-44">{CHARGE_BASIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      <Input aria-label="Default rate" placeholder="Default rate (opt.)" type="number" step="0.0001" min={0} value={rate} onChange={(e) => setRate(e.target.value)} className="h-9 w-36" />
      <Button type="submit" size="sm" disabled={pending}>Add charge</Button><FormError message={error} />
    </form>
  );
}
export function ChargeActiveButton({ id, active }: { id: string; active: boolean }) {
  const { pending, run } = useRun(); return <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setChargeActive(id, !active))}>{active ? "Deactivate" : "Activate"}</Button>;
}
export function PartyRateForm({ parties, charges, today }: { parties: { id: string; name: string }[]; charges: { id: string; name: string }[]; today: string }) {
  const { pending, error, run } = useRun(); const [party, setParty] = useState(""); const [charge, setCharge] = useState(""); const [rate, setRate] = useState(""); const [from, setFrom] = useState(today); const [to, setTo] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addPartyRate({ party_id: party, charge_type_id: charge, rate: Number(rate), effective_from: from, effective_to: to || null, notes: null }), undefined, () => setRate("")); }}>
      <Select aria-label="Party" value={party} onChange={(e) => setParty(e.target.value)} className="h-9 w-48" required><option value="">Party…</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <Select aria-label="Charge" value={charge} onChange={(e) => setCharge(e.target.value)} className="h-9 w-48" required><option value="">Charge…</option>{charges.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <Input aria-label="Rate" placeholder="Rate (₹)" type="number" step="0.0001" min={0} value={rate} onChange={(e) => setRate(e.target.value)} className="h-9 w-28" required />
      <Input aria-label="Effective from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" required />
      <Input aria-label="Effective to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
      <Button type="submit" size="sm" disabled={pending}>Add rate</Button><FormError message={error} />
    </form>
  );
}
export function EndRateButton({ id, date }: { id: string; date: string }) {
  const { pending, run } = useRun(); return <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => endPartyRate(id, date))}>End today</Button>;
}
