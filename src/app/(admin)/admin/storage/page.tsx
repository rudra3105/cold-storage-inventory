import { createClient } from "@/lib/supabase/server";
import { requireInternal } from "@/lib/auth/context";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AddChamber, AddRack, RackRow, SimpleAction } from "@/components/forms/storage-controls";
import { addChamber, addFloor, addRack, setLocationActive, updateRack } from "./actions";
import { fmtNum } from "@/lib/utils";

export const metadata = { title: "Storage" };

export default async function StoragePage() {
  const ctx = await requireInternal();
  const can = ctx.can("location.manage");
  const supabase = await createClient();
  const [chambers, floors, racks, stock] = await Promise.all([
    supabase.from("chambers").select("*").order("sort_order").order("code"),
    supabase.from("floors").select("*").order("floor_no"),
    supabase.from("racks").select("*").order("code"),
    supabase.from("stock_balances").select("rack_id,floor_id,chamber_id,available_bags,available_kgs"),
  ]);
  const err = chambers.error ?? floors.error ?? racks.error ?? stock.error;
  if (err) throw new Error(err.message);
  const sum = (key: "rack_id" | "floor_id" | "chamber_id", id: string) => (stock.data ?? []).filter((s) => s[key] === id).reduce((a, s) => a + Number(s.available_bags), 0);

  return (
    <>
      <PageHeader title="Storage Rooms" description="Chambers → floors → racks. Every bag is traceable to a rack; locations holding stock cannot be deactivated." />
      <div className="space-y-4">
        {(chambers.data ?? []).map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle className="text-base">{c.name} <span className="text-muted-foreground">({c.code})</span> {!c.is_active && <Badge variant="warning">Inactive</Badge>}</CardTitle>
                <CardDescription>{fmtNum(sum("chamber_id", c.id))} bags stored</CardDescription></div>
              {can && <div className="flex gap-2">
                <SimpleAction label="Add floor" run={async () => { "use server"; return addFloor(c.id); }} />
                <SimpleAction label={c.is_active ? "Deactivate" : "Activate"} run={async () => { "use server"; return setLocationActive("chamber", c.id, !c.is_active); }} />
              </div>}
            </CardHeader>
            <CardContent className="space-y-3">
              {(floors.data ?? []).filter((f) => f.chamber_id === c.id).map((f) => {
                const fr = (racks.data ?? []).filter((r) => r.floor_id === f.id);
                return (
                  <div key={f.id} className="rounded-xl border p-4">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Floor {f.floor_no} {!f.is_active && <Badge variant="warning">Inactive</Badge>} <span className="ml-2 font-normal text-muted-foreground">{fmtNum(sum("floor_id", f.id))} bags · {fr.length} rack{fr.length === 1 ? "" : "s"}</span></p>
                      {can && <SimpleAction variant="ghost" label={f.is_active ? "Deactivate floor" : "Activate floor"} run={async () => { "use server"; return setLocationActive("floor", f.id, !f.is_active); }} />}
                    </div>
                    <div className="divide-y">
                      {fr.length === 0 && <p className="py-2 text-sm text-muted-foreground">No racks yet — stock cannot be placed on this floor until a rack is added.</p>}
                      {fr.map((r) => can
                        ? <div key={r.id} className="flex items-center justify-between gap-3"><RackRow id={r.id} code={r.code} capacity={r.capacity_bags} active={r.is_active} update={updateRack} setActive={async (id, a) => { "use server"; return setLocationActive("rack", id, a); }} /><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtNum(sum("rack_id", r.id))} bags</span></div>
                        : <div key={r.id} className="flex justify-between py-1.5 text-sm"><span>{r.code}</span><span className="tabular-nums text-muted-foreground">{fmtNum(sum("rack_id", r.id))} bags</span></div>)}
                    </div>
                    {can && <div className="mt-2 border-t pt-2"><AddRack floorId={f.id} add={addRack} /></div>}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
        {can && <Card><CardHeader><CardTitle>Add chamber</CardTitle><CardDescription>New chambers start with no floors; use “Add floor” on the chamber.</CardDescription></CardHeader><CardContent><AddChamber add={addChamber} /></CardContent></Card>}
      </div>
    </>
  );
}
