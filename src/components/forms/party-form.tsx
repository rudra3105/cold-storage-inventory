"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { partySchema, type PartyValues } from "@/lib/schemas";
import { saveParty } from "@/app/(admin)/admin/parties/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, FormSuccess } from "./field";
import { SubmitButton } from "./submit-button";

export function PartyForm({ id, initial, canEdit }: { id: string | null; initial: PartyValues; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<PartyValues>({ resolver: zodResolver(partySchema), defaultValues: initial });
  const submit = handleSubmit((v) => start(async () => {
    setError(null); setSaved(false);
    const r = await saveParty(id, v);
    if (!r.ok) return setError(r.error);
    if (!id) router.push(`/admin/parties/${r.data.id}`); else { setSaved(true); router.refresh(); }
  }));
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset disabled={!canEdit || pending} className="grid gap-4 sm:grid-cols-2">
        <Field label="Party name *" error={errors.name?.message} htmlFor="name"><Input id="name" {...register("name")} aria-invalid={!!errors.name} /></Field>
        <Field label="Contact person" error={errors.contact_person?.message} htmlFor="cp"><Input id="cp" {...register("contact_person")} /></Field>
        <Field label="Mobile number" error={errors.mobile?.message} htmlFor="mobile"><Input id="mobile" inputMode="tel" {...register("mobile")} /></Field>
        <Field label="Email" error={errors.email?.message} htmlFor="email"><Input id="email" type="email" {...register("email")} /></Field>
        <Field label="Address" className="sm:col-span-2" error={errors.address?.message} htmlFor="addr"><Input id="addr" {...register("address")} /></Field>
        <Field label="City" error={errors.city?.message} htmlFor="city"><Input id="city" {...register("city")} /></Field>
        <Field label="State" error={errors.state?.message} htmlFor="state"><Input id="state" {...register("state")} /></Field>
        <Field label="GST number (optional)" error={errors.gst_number?.message} htmlFor="gst"><Input id="gst" className="uppercase" {...register("gst_number")} /></Field>
        <Field label="Opening balance (₹)" error={errors.opening_balance?.message} htmlFor="ob" hint="Positive = party owes us. Negative = we owe the party. Locked once ledger entries exist.">
          <Input id="ob" type="number" step="0.01" inputMode="decimal" {...register("opening_balance", { valueAsNumber: true })} />
        </Field>
        <Field label="Remarks" className="sm:col-span-2" error={errors.remarks?.message} htmlFor="rem"><Textarea id="rem" {...register("remarks")} /></Field>
      </fieldset>
      <FormError message={error} /><FormSuccess message={saved ? "Saved." : null} />
      {canEdit && <SubmitButton pending={pending}>{id ? "Save changes" : "Create party"}</SubmitButton>}
    </form>
  );
}
