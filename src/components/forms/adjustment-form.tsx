"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { adjustmentSchema, type AdjustmentValues } from "@/lib/schemas";
import { postAdjustment } from "@/lib/inventory-actions";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FormError, FormSuccess } from "./field";
import { SubmitButton } from "./submit-button";

type Opt = { id: string; label: string };
export function AdjustmentForm({ parties, products, racks, today }: { parties: Opt[]; products: Opt[]; racks: Opt[]; today: string }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null); const [okMsg, setOk] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<AdjustmentValues>({ resolver: zodResolver(adjustmentSchema), defaultValues: { adj_date: today, reason: "", bags_delta: 0, kgs_delta: 0 } as never });
  const submit = handleSubmit((v) => start(async () => {
    setError(null); setOk(null);
    const r = await postAdjustment(v);
    if (!r.ok) return setError(r.error);
    setOk(`Adjustment ${r.data.adj_no} posted.`); reset({ adj_date: today, reason: "", bags_delta: 0, kgs_delta: 0 } as never); router.refresh();
  }));
  return (
    <Card><CardContent className="pt-5"><form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Party *" error={errors.party_id?.message} htmlFor="ap"><Select id="ap" {...register("party_id")}><option value="">Select…</option>{parties.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
      <Field label="Product *" error={errors.product_id?.message} htmlFor="apr"><Select id="apr" {...register("product_id")}><option value="">Select…</option>{products.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
      <Field label="Rack *" error={errors.rack_id?.message} htmlFor="ark"><Select id="ark" {...register("rack_id")}><option value="">Select…</option>{racks.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
      <Field label="Date *" error={errors.adj_date?.message} htmlFor="ad"><Input id="ad" type="date" {...register("adj_date")} /></Field>
      <Field label="Bags change (+/−) *" error={errors.bags_delta?.message} htmlFor="ab" hint="Negative removes stock"><Input id="ab" type="number" step="1" {...register("bags_delta", { valueAsNumber: true })} /></Field>
      <Field label="Kgs change (+/−) *" error={errors.kgs_delta?.message} htmlFor="ak"><Input id="ak" type="number" step="0.001" {...register("kgs_delta", { valueAsNumber: true })} /></Field>
      <Field label="Reason *" error={errors.reason?.message} className="sm:col-span-2" htmlFor="ar"><Input id="ar" placeholder="Why is this adjustment needed?" {...register("reason")} /></Field>
      <div className="sm:col-span-2 lg:col-span-4 space-y-2"><FormError message={error} /><FormSuccess message={okMsg} /><SubmitButton pending={pending}>Post adjustment</SubmitButton>
        <p className="text-sm text-muted-foreground">Adjustments are permanent ledger entries. Stock can never be adjusted below zero.</p></div>
    </form></CardContent></Card>
  );
}
