"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { productSchema, type ProductValues } from "@/lib/schemas";
import { saveProduct } from "@/app/(admin)/admin/products/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, FormSuccess } from "./field";
import { SubmitButton } from "./submit-button";

export function ProductForm({ id, initial, canEdit, compact = false, onSaved }: {
  id: string | null; initial: ProductValues; canEdit: boolean; compact?: boolean; onSaved?: (p: { id: string; name: string }) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProductValues>({ resolver: zodResolver(productSchema), defaultValues: initial });
  const submit = handleSubmit((v) => start(async () => {
    setError(null); setSaved(false);
    const r = await saveProduct(id, v);
    if (!r.ok) return setError(r.error);
    if (onSaved) { onSaved(r.data); reset(initial); return; }
    if (!id) router.push(`/admin/products/${r.data.id}`); else { setSaved(true); router.refresh(); }
  }));
  return (
    <form onSubmit={(e) => { e.stopPropagation(); void submit(e); }} className="space-y-4" noValidate>
      <fieldset disabled={!canEdit || pending} className={compact ? "grid gap-3 sm:grid-cols-4" : "grid gap-4 sm:grid-cols-2"}>
        <Field label="Product name *" error={errors.name?.message} htmlFor={`pn${id}`}><Input id={`pn${id}`} {...register("name")} aria-invalid={!!errors.name} /></Field>
        <Field label="Category" error={errors.category?.message} htmlFor={`pc${id}`}><Input id={`pc${id}`} {...register("category")} /></Field>
        <Field label="Default unit *" error={errors.default_unit?.message} htmlFor={`pu${id}`}><Input id={`pu${id}`} {...register("default_unit")} /></Field>
        <Field label="Default kgs / bag" error={errors.default_kgs_per_bag?.message} htmlFor={`pk${id}`}>
          <Input id={`pk${id}`} type="number" step="0.001" inputMode="decimal" {...register("default_kgs_per_bag", { setValueAs: (v) => (v === "" || v == null ? null : Number(v)) })} />
        </Field>
        {!compact && <Field label="Description" className="sm:col-span-2" error={errors.description?.message} htmlFor={`pd${id}`}><Textarea id={`pd${id}`} {...register("description")} /></Field>}
      </fieldset>
      <FormError message={error} /><FormSuccess message={saved ? "Saved." : null} />
      {canEdit && <SubmitButton pending={pending}>{id ? "Save changes" : "Add product"}</SubmitButton>}
    </form>
  );
}
