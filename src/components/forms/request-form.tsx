"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { requestSchema } from "@/lib/schemas";
import { cancelRequest, submitRequest } from "@/lib/portal-actions";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FormError, FormSuccess } from "./field";
import { SubmitButton } from "./submit-button";

type V = z.input<typeof requestSchema>;
export function RequestForm({ products }: { products: { id: string; label: string; bags: number }[] }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [error, setError] = useState<string | null>(null); const [okMsg, setOk] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<V>({ resolver: zodResolver(requestSchema) as never, defaultValues: { product_id: "", preferred_date: "", remarks: "" } as never });
  return (
    <Card><CardContent className="pt-5"><form noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={handleSubmit((v) => start(async () => {
      setError(null); setOk(null); const r = await submitRequest(v); if (!r.ok) return setError(r.error); setOk(`Request ${r.data.request_no} sent. The warehouse will review it; stock is only reduced when the goods are actually dispatched.`); reset(); router.refresh(); }))}>
      <Field label="Product *" error={errors.product_id?.message} htmlFor="rq-p"><Select id="rq-p" {...register("product_id")}><option value="">Select…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.bags.toLocaleString("en-IN")} bags)</option>)}</Select></Field>
      <Field label="Bags *" error={errors.bags?.message} htmlFor="rq-b"><Input id="rq-b" type="number" step="1" min={1} {...register("bags", { valueAsNumber: true })} /></Field>
      <Field label="Preferred date" htmlFor="rq-d"><Input id="rq-d" type="date" {...register("preferred_date")} /></Field>
      <Field label="Remarks" htmlFor="rq-r"><Input id="rq-r" {...register("remarks")} /></Field>
      <div className="sm:col-span-2 lg:col-span-4 space-y-2"><FormError message={error} /><FormSuccess message={okMsg} /><SubmitButton pending={pending}>Submit request</SubmitButton></div>
    </form></CardContent></Card>
  );
}
export function CancelRequestButton({ id }: { id: string }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [error, setError] = useState<string | null>(null);
  return <><Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await cancelRequest(id); if (!r.ok) return setError(r.error); router.refresh(); })}>Cancel request</Button>{error && <span className="ml-2 text-sm font-medium text-destructive">{error}</span>}</>;
}
