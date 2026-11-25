"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch, type Control, type UseFormRegister, type UseFormSetValue, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { inwardSchema, outwardSchema, type InwardValues } from "@/lib/schemas";
import { getPartyStock, type StockPosition } from "@/lib/stock-actions";
import type { ActionResult } from "@/lib/action-utils";
import type { Chamber, Floor, Party, Product, Rack } from "@/lib/data";
import { listActiveProducts } from "@/app/(admin)/admin/products/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { fmtNum } from "@/lib/utils";
import { Field, FormError } from "./field";
import { SubmitButton } from "./submit-button";
import { ProductForm } from "./product-form";

type Kind = "inward" | "outward";
type FormValues = InwardValues & { outward_date?: string; outward_request_id?: string | null };
type SaveResult = ActionResult<{ id: string; inward_no?: string; outward_no?: string; total_bags: number; total_kgs: number }>;
const emptyLine = { product_id: "", chamber_id: "", floor_id: "", rack_id: "", bags: NaN, kgs_per_bag: NaN, wages_party: 0, wages_labour: 0, remarks: "" };

export function StockDocForm(props: {
  kind: Kind; docId?: string; initial: FormValues; lockParty?: boolean;
  parties: Party[]; products: Product[]; chambers: Chamber[]; floors: Floor[]; racks: Rack[];
  canAddProduct?: boolean;
  save: (values: never, clientRequestId: string) => Promise<SaveResult>;
  update?: (id: string, values: never) => Promise<SaveResult>;
}) {
  const { kind, docId, parties, chambers, floors, racks } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; no: string; bags: number; kgs: number } | null>(null);
  const [products, setProducts] = useState(props.products);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [stock, setStock] = useState<StockPosition[]>([]);
  const [stockMsg, setStockMsg] = useState<string | null>(null);
  const requestId = useRef<string>(typeof crypto !== "undefined" ? crypto.randomUUID() : "");
  const schema = kind === "inward" ? inwardSchema : outwardSchema;
  const dateKey = (kind === "inward" ? "inward_date" : "outward_date") as "inward_date";

  const form = useForm<FormValues>({
    resolver: zodResolver(kind === "inward" ? inwardSchema : (outwardSchema as unknown as typeof inwardSchema)) as never,
    defaultValues: props.initial,
  });
  const { register, control, handleSubmit, setValue, formState: { errors } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const partyId = useWatch({ control, name: "party_id" });
  const watched = useWatch({ control, name: "lines" });
  void schema;

  const loadStock = useCallback(async (pid: string) => {
    if (kind !== "outward" || !pid) { setStock([]); return; }
    const r = await getPartyStock(pid);
    if (!r.ok) { setStockMsg(r.error); return; }
    setStockMsg(null); setStock(r.data);
  }, [kind]);
  // Fetching live stock from the server when the party changes (external system sync).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadStock(partyId); }, [partyId, loadStock]);

  // when editing an outward, the document's own quantities are available again
  const own = useMemo(() => {
    const m = new Map<string, { bags: number; kgs: number }>();
    if (kind === "outward" && docId) for (const l of props.initial.lines) { const k = `${l.product_id}:${l.rack_id}`; const c = m.get(k) ?? { bags: 0, kgs: 0 }; m.set(k, { bags: c.bags + l.bags, kgs: c.kgs + l.bags * l.kgs_per_bag }); }
    return m;
  }, [kind, docId, props.initial.lines]);
  const positions = useMemo(() => {
    const byKey = new Map(stock.map((s) => [s.key, { ...s }]));
    own.forEach((o, k) => {
      const s = byKey.get(k);
      if (s) { s.available_bags += o.bags; s.available_kgs += o.kgs; }
      else {
        const l = props.initial.lines.find((x) => `${x.product_id}:${x.rack_id}` === k);
        const rack = racks.find((r) => r.id === l?.rack_id); const fl = floors.find((f) => f.id === rack?.floor_id); const ch = chambers.find((c) => c.id === fl?.chamber_id);
        byKey.set(k, { key: k, product_id: l!.product_id, product_name: products.find((p) => p.id === l!.product_id)?.name ?? "Product", rack_id: l!.rack_id, floor_id: l!.floor_id, chamber_id: l!.chamber_id,
          location: `${ch?.code} / Floor ${fl?.floor_no} / ${rack?.code}`, available_bags: o.bags, available_kgs: o.kgs });
      }
    });
    return [...byKey.values()];
  }, [stock, own, props.initial.lines, racks, floors, chambers, products]);

  const totals = (watched ?? []).reduce((a, l) => ({ bags: a.bags + (Number(l?.bags) || 0), kgs: a.kgs + (Number(l?.bags) || 0) * (Number(l?.kgs_per_bag) || 0) }), { bags: 0, kgs: 0 });

  // requestId.current is only read inside the submit handler, never during render.
  // eslint-disable-next-line react-hooks/refs
  const onSubmit = handleSubmit((values) => start(async () => {
    setError(null);
    const payload = (kind === "inward"
      ? { ...values, wb_kgs: Number.isNaN(values.wb_kgs as number) ? null : values.wb_kgs ?? null }
      : { outward_date: (values as unknown as { outward_date: string }).outward_date, party_id: values.party_id, vehicle_no: values.vehicle_no, remarks: values.remarks, lines: values.lines, outward_request_id: values.outward_request_id ?? null }) as never;
    const r = docId && props.update ? await props.update(docId, payload) : await props.save(payload, requestId.current);
    if (!r.ok) return setError(r.error);
    setDone({ id: r.data.id, no: (r.data.inward_no ?? r.data.outward_no)!, bags: r.data.total_bags, kgs: Number(r.data.total_kgs) });
    router.refresh();
  }), () => setError("Please fix the highlighted fields."));

  const base = `/admin/${kind}`;
  if (done) {
    return (
      <Card><CardContent className="space-y-4 py-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <div><p className="text-lg font-semibold">{kind === "inward" ? "Goods In" : "Goods Out"} {docId ? "updated" : "saved"}: {done.no}</p>
          <p className="text-sm text-muted-foreground">{fmtNum(done.bags)} bags · {fmtNum(done.kgs)} kg</p></div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild><a href={`/api/pdf/${kind}/${done.id}`} target="_blank" rel="noopener"><Printer /> Print receipt</a></Button>
          <Button asChild variant="outline"><Link href={`${base}/${done.id}`}>View</Link></Button>
          <Button asChild variant="outline"><Link href={`${base}/new`} onClick={() => { requestId.current = crypto.randomUUID(); setDone(null); }}>Enter another</Link></Button>
          <Button asChild variant="ghost"><Link href={base}>See all entries</Link></Button>
        </div>
      </CardContent></Card>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Card><CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={`${kind === "inward" ? "Goods In" : "Goods Out"} number`} hint="Given automatically when you save"><Input disabled value={docId ? "Assigned" : "Auto"} readOnly /></Field>
        <Field label="Date *" error={(errors as FieldErrors<Record<string, never>>)[dateKey]?.message as string | undefined} htmlFor="d"><Input id="d" type="date" max={new Date().toLocaleDateString("en-CA")} {...register(dateKey)} /></Field>
        <Field label="Party *" error={errors.party_id?.message} htmlFor="party" className="sm:col-span-2">
          <Controller control={control} name="party_id" render={({ field }) => (
            <Select id="party" {...field} disabled={props.lockParty} aria-invalid={!!errors.party_id} onChange={(e) => { field.onChange(e); if (kind === "outward") setValue("lines", [{ ...emptyLine } as never]); }}>
              <option value="">Choose party…</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}{p.city ? ` — ${p.city}` : ""}</option>)}
            </Select>)} />
        </Field>
        <Field label="Vehicle number" error={errors.vehicle_no?.message} htmlFor="veh"><Input id="veh" className="uppercase" placeholder="GJ05AB1234" {...register("vehicle_no")} /></Field>
        <details className="sm:col-span-2 lg:col-span-4" open={!!(errors.wb_kgs || errors.remarks)}>
          <summary className="cursor-pointer text-sm font-medium text-primary">More details (optional)</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {kind === "inward" && <Field label="Weighbridge (WB) kgs" error={errors.wb_kgs?.message as string | undefined} htmlFor="wb"><Input id="wb" type="number" step="0.001" inputMode="decimal" {...register("wb_kgs", { setValueAs: (v) => (v === "" || v == null ? null : Number(v)) })} /></Field>}
        <Field label="Remarks" className="sm:col-span-2" error={errors.remarks?.message} htmlFor="rem"><Input id="rem" {...register("remarks")} /></Field>
          </div>
        </details>
      </CardContent></Card>

      {kind === "outward" && partyId && (
        <p className="rounded-xl bg-muted px-4 py-3 text-base" role="status">
          {stockMsg ?? (positions.length === 0 ? "This party has no stock available to dispatch." : `${positions.length} stock location${positions.length === 1 ? "" : "s"} available · ${fmtNum(positions.reduce((a, s) => a + s.available_bags, 0))} bags in total`)}
        </p>
      )}

      <div className="space-y-3">
        {fields.map((f, i) => (
          <LineCard key={f.id} index={i} kind={kind} control={control} register={register} setValue={setValue} errors={errors} products={products} chambers={chambers} floors={floors} racks={racks}
            positions={positions} canRemove={fields.length > 1} onRemove={() => remove(i)} />
        ))}
        {typeof errors.lines?.message === "string" && <p role="alert" className="text-sm font-medium text-destructive">{errors.lines.message}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => append({ ...emptyLine } as never)}><Plus /> Add another product</Button>
          {kind === "inward" && <>
            <Button type="button" variant="ghost" size="sm" onClick={async () => setProducts(await listActiveProducts() as Product[])}><RefreshCw /> Refresh product list</Button>
            {props.canAddProduct && <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddProduct((s) => !s)}><Plus /> Add new product</Button>}
          </>}
        </div>
        {showAddProduct && (
          <Card><CardContent className="pt-4">
            <ProductForm id={null} canEdit compact initial={{ name: "", category: "", description: "", default_unit: "BAG", default_kgs_per_bag: null }}
              onSaved={async () => { setProducts(await listActiveProducts() as Product[]); setShowAddProduct(false); }} />
          </CardContent></Card>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
        <p className="text-sm">Total: <b className="tabular-nums">{fmtNum(totals.bags)}</b> bags · <b className="tabular-nums">{fmtNum(totals.kgs)}</b> kg</p>
        <div className="flex gap-2">
          <Button asChild variant="ghost"><Link href={base}>{docId ? "Back" : "See all entries"}</Link></Button>
          <SubmitButton pending={pending}>{docId ? "Save changes" : kind === "inward" ? "Save Goods In" : "Save Goods Out"}</SubmitButton>
        </div>
      </div>
      <FormError message={error} />
    </form>
  );
}

function LineCard({ index: i, kind, control, register, setValue, errors, products, chambers, floors, racks, positions, canRemove, onRemove }: {
  index: number; kind: Kind; control: Control<FormValues>; register: UseFormRegister<FormValues>; setValue: UseFormSetValue<FormValues>; errors: FieldErrors<FormValues>;
  products: Product[]; chambers: Chamber[]; floors: Floor[]; racks: Rack[]; positions: StockPosition[]; canRemove: boolean; onRemove: () => void;
}) {
  const line = useWatch({ control, name: `lines.${i}` });
  const e = errors.lines?.[i];
  const floorsOf = floors.filter((f) => f.chamber_id === line?.chamber_id);
  const racksOf = racks.filter((r) => r.floor_id === line?.floor_id);
  const total = (Number(line?.bags) || 0) * (Number(line?.kgs_per_bag) || 0);
  const key = `${line?.product_id}:${line?.rack_id}`;
  const pos = kind === "outward" ? positions.find((p) => p.key === key) : undefined;
  const over = pos && Number(line?.bags) > pos.available_bags;

  return (
    <Card><CardContent className="space-y-3 pt-4">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold">Line {i + 1}</p>{canRemove && <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove line ${i + 1}`}><Trash2 /> Remove</Button>}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kind === "inward" ? (<>
          <Field label="Product *" error={e?.product_id?.message} htmlFor={`p${i}`} className="lg:col-span-2">
            <Select id={`p${i}`} {...register(`lines.${i}.product_id`, { onChange: (ev) => { const p = products.find((x) => x.id === ev.target.value); if (p?.default_kgs_per_bag && !Number(line?.kgs_per_bag)) setValue(`lines.${i}.kgs_per_bag`, Number(p.default_kgs_per_bag)); } })} aria-invalid={!!e?.product_id}>
              <option value="">Choose product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Chamber *" error={e?.chamber_id?.message} htmlFor={`c${i}`}>
            <Select id={`c${i}`} {...register(`lines.${i}.chamber_id`, { onChange: () => { setValue(`lines.${i}.floor_id`, ""); setValue(`lines.${i}.rack_id`, ""); } })} aria-invalid={!!e?.chamber_id}>
              <option value="">Select…</option>{chambers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Floor *" error={e?.floor_id?.message} htmlFor={`f${i}`}>
            <Select id={`f${i}`} {...register(`lines.${i}.floor_id`, { onChange: () => setValue(`lines.${i}.rack_id`, "") })} disabled={!line?.chamber_id} aria-invalid={!!e?.floor_id}>
              <option value="">Select…</option>{floorsOf.map((f) => <option key={f.id} value={f.id}>Floor {f.floor_no}</option>)}
            </Select>
          </Field>
          <Field label="Rack *" error={e?.rack_id?.message} htmlFor={`r${i}`}>
            <Select id={`r${i}`} {...register(`lines.${i}.rack_id`)} disabled={!line?.floor_id} aria-invalid={!!e?.rack_id}>
              <option value="">{line?.floor_id && racksOf.length === 0 ? "No racks on this floor" : "Select…"}</option>{racksOf.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
            </Select>
          </Field>
        </>) : (
          <Field label="Stock to dispatch (product · location) *" error={e?.product_id?.message ?? e?.rack_id?.message} className="sm:col-span-2 lg:col-span-4" htmlFor={`s${i}`}>
            <Select id={`s${i}`} value={line?.product_id && line?.rack_id ? key : ""} aria-invalid={!!(e?.product_id || e?.rack_id)} disabled={positions.length === 0}
              onChange={(ev) => {
                const s = positions.find((x) => x.key === ev.target.value);
                setValue(`lines.${i}.product_id`, s?.product_id ?? "", { shouldValidate: true }); setValue(`lines.${i}.rack_id`, s?.rack_id ?? "", { shouldValidate: true });
                setValue(`lines.${i}.floor_id`, s?.floor_id ?? ""); setValue(`lines.${i}.chamber_id`, s?.chamber_id ?? "");
                if (s && !Number(line?.kgs_per_bag)) setValue(`lines.${i}.kgs_per_bag`, Math.round((s.available_kgs / s.available_bags) * 1000) / 1000);
              }}>
              <option value="">{positions.length === 0 ? "Select a party with stock first" : "Select stock…"}</option>
              {positions.map((s) => <option key={s.key} value={s.key}>{s.product_name} — {s.location} — {fmtNum(s.available_bags)} bags ({fmtNum(s.available_kgs)} kg)</option>)}
            </Select>
          </Field>
        )}
        <Field label={kind === "outward" ? "Bags to dispatch *" : "Bags *"} error={e?.bags?.message} htmlFor={`b${i}`} hint={pos ? `Available: ${fmtNum(pos.available_bags)} bags` : undefined}>
          <Input id={`b${i}`} type="number" inputMode="numeric" min={1} step={1} aria-invalid={!!e?.bags || !!over} {...register(`lines.${i}.bags`, { valueAsNumber: true })} />
          {over && <p role="alert" className="text-sm font-medium text-destructive">More than the {fmtNum(pos!.available_bags)} bags available.</p>}
        </Field>
        <Field label="Kgs / bag *" error={e?.kgs_per_bag?.message} htmlFor={`k${i}`}><Input id={`k${i}`} type="number" inputMode="decimal" step="0.001" {...register(`lines.${i}.kgs_per_bag`, { valueAsNumber: true })} /></Field>
        <Field label="Total kgs" htmlFor={`t${i}`}><Input id={`t${i}`} readOnly disabled value={fmtNum(total)} className="tabular-nums" /></Field>
        <details className="sm:col-span-2 lg:col-span-4" open={!!(e?.wages_party || e?.wages_labour || e?.remarks)}>
          <summary className="cursor-pointer text-sm font-medium text-primary">More details: wages, remarks (optional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Wages charged to party (₹)" error={e?.wages_party?.message} htmlFor={`wp${i}`}><Input id={`wp${i}`} type="number" inputMode="decimal" step="0.01" min={0} {...register(`lines.${i}.wages_party`, { valueAsNumber: true })} /></Field>
        <Field label="Wages paid to labour (₹)" error={e?.wages_labour?.message} htmlFor={`wl${i}`}><Input id={`wl${i}`} type="number" inputMode="decimal" step="0.01" min={0} {...register(`lines.${i}.wages_labour`, { valueAsNumber: true })} /></Field>
        <Field label="Line remarks" className="sm:col-span-2" htmlFor={`lr${i}`}><Textarea id={`lr${i}`} rows={1} className="min-h-10" {...register(`lines.${i}.remarks`)} /></Field>
          </div>
        </details>
      </div>
    </CardContent></Card>
  );
}
