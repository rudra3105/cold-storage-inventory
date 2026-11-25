"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Plus, Printer, Trash2 } from "lucide-react";
import { invoiceSchema, paymentSchema, receiptSchema, PAYMENT_MODES, type InvoiceValues, type PaymentValues, type ReceiptValues } from "@/lib/schemas";
import { createPaymentAction, createReceiptAction, getOutstandingInvoices, saveInvoiceAction, suggestRate, type OutstandingInvoice } from "@/lib/billing-actions";
import type { Party } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { fmtMoney } from "@/lib/utils";
import { Field, FormError } from "./field";
import { SubmitButton } from "./submit-button";

type Charge = { id: string; name: string; basis: string; default_rate: number | null };

export function InvoiceForm({ id, initial, parties, charges }: { id: string | null; initial: InvoiceValues; parties: Party[]; charges: Charge[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit, setValue, getValues, formState: { errors } } = useForm<InvoiceValues>({ resolver: zodResolver(invoiceSchema), defaultValues: initial });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const items = useWatch({ control, name: "items" });
  const sub = (items ?? []).reduce((a, i) => a + Math.round((Number(i?.quantity) || 0) * (Number(i?.rate) || 0) * 100) / 100, 0);
  const tax = (items ?? []).reduce((a, i) => a + Math.round(Math.round((Number(i?.quantity) || 0) * (Number(i?.rate) || 0) * 100) / 100 * (Number(i?.tax_percent) || 0)) / 100, 0);
  const onCharge = async (i: number, chargeId: string) => {
    if (!chargeId) return;
    const r = await suggestRate(getValues("party_id"), chargeId, getValues("invoice_date"));
    if (!r.ok) return;
    if (!getValues(`items.${i}.description`)) setValue(`items.${i}.description`, r.data.name);
    if (r.data.rate != null) setValue(`items.${i}.rate`, r.data.rate);
  };
  const submit = handleSubmit((v) => start(async () => {
    setError(null);
    const r = await saveInvoiceAction(id, v);
    if (!r.ok) return setError(r.error);
    router.push(`/admin/invoices/${r.data.id}`); router.refresh();
  }), () => setError("Please fix the highlighted fields."));
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Card><CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Party *" error={errors.party_id?.message} className="sm:col-span-2" htmlFor="ip"><Select id="ip" {...register("party_id")} disabled={!!id}><option value="">Select party…</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Invoice date *" error={errors.invoice_date?.message} htmlFor="idt"><Input id="idt" type="date" {...register("invoice_date")} /></Field>
        <Field label="Due date" error={errors.due_date?.message} htmlFor="idd"><Input id="idd" type="date" {...register("due_date")} /></Field>
        <Field label="Period from" htmlFor="ipf"><Input id="ipf" type="date" {...register("period_from")} /></Field>
        <Field label="Period to" htmlFor="ipt"><Input id="ipt" type="date" {...register("period_to")} /></Field>
        <Field label="Notes" className="sm:col-span-2" htmlFor="inotes"><Input id="inotes" {...register("notes")} /></Field>
      </CardContent></Card>
      <Card><CardContent className="space-y-3 pt-5">
        <p className="text-sm text-muted-foreground">No billing formula is assumed: enter quantity and rate per line. Choosing a charge fills the party&apos;s configured rate (or the default) which you can override.</p>
        {fields.map((f, i) => (
          <div key={f.id} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-6">
            <Field label="Charge" htmlFor={`c${i}`}><Select id={`c${i}`} {...register(`items.${i}.charge_type_id`, { onChange: (e) => void onCharge(i, e.target.value) })}><option value="">Custom</option>{charges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Description *" className="sm:col-span-2" error={errors.items?.[i]?.description?.message} htmlFor={`d${i}`}><Input id={`d${i}`} {...register(`items.${i}.description`)} /></Field>
            <Field label="Quantity *" error={errors.items?.[i]?.quantity?.message} htmlFor={`q${i}`}><Input id={`q${i}`} type="number" step="0.001" inputMode="decimal" {...register(`items.${i}.quantity`, { valueAsNumber: true })} /></Field>
            <Field label="Unit" htmlFor={`u${i}`}><Input id={`u${i}`} placeholder="bag, kg…" {...register(`items.${i}.unit`)} /></Field>
            <Field label="Rate (₹) *" error={errors.items?.[i]?.rate?.message} htmlFor={`r${i}`}><Input id={`r${i}`} type="number" step="0.0001" inputMode="decimal" {...register(`items.${i}.rate`, { valueAsNumber: true })} /></Field>
            <Field label="Tax %" error={errors.items?.[i]?.tax_percent?.message} htmlFor={`t${i}`}><Input id={`t${i}`} type="number" step="0.01" inputMode="decimal" {...register(`items.${i}.tax_percent`, { valueAsNumber: true })} /></Field>
            <div className="flex items-end justify-between sm:col-span-5"><p className="text-sm tabular-nums">Line amount: <b>{fmtMoney((Number(items?.[i]?.quantity) || 0) * (Number(items?.[i]?.rate) || 0))}</b></p></div>
            <div className="flex items-end justify-end">{fields.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`}><Trash2 /> Remove</Button>}</div>
          </div>
        ))}
        {typeof errors.items?.message === "string" && <p role="alert" className="text-sm font-medium text-destructive">{errors.items.message}</p>}
        <Button type="button" variant="outline" size="sm" onClick={() => append({ description: "", charge_type_id: "", quantity: NaN, unit: "", rate: NaN, tax_percent: 0 } as never)}><Plus /> Add line</Button>
      </CardContent></Card>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
        <p className="text-sm tabular-nums">Subtotal {fmtMoney(sub)} · Tax {fmtMoney(tax)} · <b>Total {fmtMoney(sub + tax)}</b> <span className="text-muted-foreground">(final amounts are computed by the server)</span></p>
        <SubmitButton pending={pending}>{id ? "Save draft" : "Create draft"}</SubmitButton>
      </div>
      <FormError message={error} />
    </form>
  );
}

export function ReceiptForm({ initial, parties }: { initial: ReceiptValues; parties: Party[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; no: string } | null>(null);
  const [open, setOpen] = useState<OutstandingInvoice[]>([]);
  const { register, control, handleSubmit, formState: { errors } } = useForm<ReceiptValues>({ resolver: zodResolver(receiptSchema), defaultValues: initial });
  const { replace } = useFieldArray({ control, name: "allocations" });
  const party = useWatch({ control, name: "party_id" }); const amount = useWatch({ control, name: "amount" }); const allocs = useWatch({ control, name: "allocations" });
  useEffect(() => { let live = true; (async () => { if (!party) { setOpen([]); replace([]); return; } const r = await getOutstandingInvoices(party); if (!live || !r.ok) return; setOpen(r.data); replace(r.data.map((i) => ({ invoice_id: i.id, amount: initial.allocations.find((a) => a.invoice_id === i.id)?.amount ?? 0 }))); })(); return () => { live = false; }; }, [party]); // eslint-disable-line react-hooks/exhaustive-deps
  const allocated = (allocs ?? []).reduce((a, x) => a + (Number(x?.amount) || 0), 0);
  const auto = () => { let left = Number(amount) || 0; replace(open.map((i) => { const a = Math.min(left, i.outstanding); left -= a; return { invoice_id: i.id, amount: Math.round(a * 100) / 100 }; })); };
  const submit = handleSubmit((v) => start(async () => {
    setError(null);
    if (v.allocations.reduce((a, x) => a + x.amount, 0) > v.amount + 0.001) return setError("Allocated amount exceeds the receipt amount.");
    const r = await createReceiptAction(v);
    if (!r.ok) return setError(r.error);
    setDone({ id: r.data.id, no: r.data.receipt_no });
  }));
  if (done) return (
    <Card><CardContent className="space-y-4 py-8 text-center"><CheckCircle2 className="mx-auto size-10 text-success" /><p className="text-lg font-semibold">Receipt saved: {done.no}</p>
      <div className="flex flex-wrap justify-center gap-2"><Button asChild><a href={`/api/pdf/receipt/${done.id}`} target="_blank" rel="noopener"><Printer /> Print</a></Button><Button asChild variant="outline"><Link href={`/admin/receipts/${done.id}`}>View</Link></Button><Button asChild variant="ghost"><Link href="/admin/receipts">Show all</Link></Button></div></CardContent></Card>
  );
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Card><CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Party *" error={errors.party_id?.message} className="sm:col-span-2" htmlFor="rp"><Select id="rp" {...register("party_id")}><option value="">Select party…</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Date *" error={errors.receipt_date?.message} htmlFor="rd"><Input id="rd" type="date" {...register("receipt_date")} /></Field>
        <Field label="Amount (₹) *" error={errors.amount?.message} htmlFor="ra"><Input id="ra" type="number" step="0.01" inputMode="decimal" {...register("amount", { valueAsNumber: true })} /></Field>
        <Field label="Mode *" error={errors.payment_mode?.message} htmlFor="rm"><Select id="rm" {...register("payment_mode")}><option value="">Select…</option>{PAYMENT_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Reference / cheque / UTR" htmlFor="rr"><Input id="rr" {...register("reference_no")} /></Field>
        <Field label="Remarks" className="sm:col-span-2" htmlFor="rrm"><Input id="rrm" {...register("remarks")} /></Field>
      </CardContent></Card>
      {party && (
        <Card><CardContent className="space-y-3 pt-5">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold">Apply to outstanding invoices <span className="font-normal text-muted-foreground">(optional)</span></p>{open.length > 0 && <Button type="button" size="sm" variant="outline" onClick={auto}>Allocate oldest first</Button>}</div>
          {open.length === 0 ? <p className="text-sm text-muted-foreground">No outstanding issued invoices for this party. The receipt will be recorded on account.</p> : open.map((i, n) => (
            <div key={i.id} className="grid items-center gap-2 sm:grid-cols-4"><span className="text-sm font-medium">{i.invoice_no}</span><span className="text-sm text-muted-foreground">Outstanding {fmtMoney(i.outstanding)}</span>
              <Input aria-label={`Amount applied to ${i.invoice_no}`} type="number" step="0.01" min={0} max={i.outstanding} inputMode="decimal" {...register(`allocations.${n}.amount`, { valueAsNumber: true })} /></div>))}
          <p className="text-sm text-muted-foreground tabular-nums">Applied {fmtMoney(allocated)} of {fmtMoney(Number(amount) || 0)} · on account {fmtMoney(Math.max(0, (Number(amount) || 0) - allocated))}</p>
        </CardContent></Card>
      )}
      <FormError message={error} /><SubmitButton pending={pending}>Save receipt</SubmitButton>
    </form>
  );
}

export function PaymentForm({ initial, parties }: { initial: PaymentValues; parties: Party[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; no: string } | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<PaymentValues>({ resolver: zodResolver(paymentSchema), defaultValues: initial });
  const submit = handleSubmit((v) => start(async () => { setError(null); const r = await createPaymentAction(v); if (!r.ok) return setError(r.error); setDone({ id: r.data.id, no: r.data.payment_no }); }));
  if (done) return (
    <Card><CardContent className="space-y-4 py-8 text-center"><CheckCircle2 className="mx-auto size-10 text-success" /><p className="text-lg font-semibold">Payment saved: {done.no}</p>
      <div className="flex flex-wrap justify-center gap-2"><Button asChild><a href={`/api/pdf/payment/${done.id}`} target="_blank" rel="noopener"><Printer /> Print voucher</a></Button><Button asChild variant="outline"><Link href="/admin/payments">Show all</Link></Button></div></CardContent></Card>
  );
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Card><CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Party (if paid to a customer)" className="sm:col-span-2" htmlFor="pp" hint="Posts to the party ledger. Leave blank for labour or other expenses."><Select id="pp" {...register("party_id")}><option value="">— not a party —</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Payee name" error={errors.payee_name?.message} className="sm:col-span-2" htmlFor="pn"><Input id="pn" {...register("payee_name")} /></Field>
        <Field label="Date *" error={errors.payment_date?.message} htmlFor="pd"><Input id="pd" type="date" {...register("payment_date")} /></Field>
        <Field label="Amount (₹) *" error={errors.amount?.message} htmlFor="pa"><Input id="pa" type="number" step="0.01" inputMode="decimal" {...register("amount", { valueAsNumber: true })} /></Field>
        <Field label="Mode *" error={errors.payment_mode?.message} htmlFor="pm"><Select id="pm" {...register("payment_mode")}><option value="">Select…</option>{PAYMENT_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Purpose" htmlFor="pu"><Input id="pu" placeholder="Labour wages, refund…" {...register("purpose")} /></Field>
        <Field label="Reference" htmlFor="pr"><Input id="pr" {...register("reference_no")} /></Field>
        <Field label="Remarks" className="sm:col-span-3" htmlFor="prm"><Textarea id="prm" rows={1} className="min-h-10" {...register("remarks")} /></Field>
      </CardContent></Card>
      <FormError message={error} /><SubmitButton pending={pending}>Save payment</SubmitButton>
    </form>
  );
}
