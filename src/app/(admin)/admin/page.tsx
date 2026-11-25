import { createClient } from "@/lib/supabase/server";
import { requireInternal } from "@/lib/auth/context";
import { HomeView, type HomeData } from "@/components/shell/home-view";

export const metadata = { title: "Home" };

type Summary = {
  parties: number; products: number; stock_bags: number; stock_kgs: number; today_inward_bags: number; today_outward_bags: number;
  total_racks: number; pending_requests: number;
  by_chamber: { id: string; code: string; name: string; bags: number; kgs: number }[];
  by_floor: { chamber_code: string; floor_no: number; bags: number; kgs: number }[];
};
type Row = { id: string; status: string; created_at: string; parties: { name: string } | { name: string }[] | null; inward_items?: { bags: number }[]; outward_items?: { bags: number }[]; inward_no?: string; inward_date?: string; outward_no?: string; outward_date?: string };

const TZ = "Asia/Kolkata";
function greeting() { const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date())); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireInternal();
  const { denied } = await searchParams;
  const supabase = await createClient();

  const [{ data: s, error }, inw, out, fl] = await Promise.all([
    supabase.rpc("dashboard_summary"),
    supabase.from("inward_transactions").select("id,inward_no,inward_date,status,created_at,parties(name),inward_items(bags)").order("created_at", { ascending: false }).limit(6),
    supabase.from("outward_transactions").select("id,outward_no,outward_date,status,created_at,parties(name),outward_items(bags)").order("created_at", { ascending: false }).limit(6),
    supabase.from("floors").select("id,chamber_id,floor_no").order("floor_no"),
  ]);
  if (error || !s) throw new Error(`Could not load the home screen: ${error?.message ?? "no data"}`);
  const sum = s as Summary;

  const toRecent = (rows: unknown[] | null, kind: "Inward" | "Outward") => ((rows ?? []) as Row[]).map((r) => {
    const items = (kind === "Inward" ? r.inward_items : r.outward_items) ?? [];
    const party = Array.isArray(r.parties) ? r.parties[0]?.name : r.parties?.name;
    return { id: r.id, kind, no: (kind === "Inward" ? r.inward_no : r.outward_no) ?? "", date: (kind === "Inward" ? r.inward_date : r.outward_date) ?? "", party: party ?? "—", bags: items.reduce((a, i) => a + i.bags, 0), status: r.status, at: r.created_at };
  });
  const recent = [...toRecent(inw.data, "Inward"), ...toRecent(out.data, "Outward")].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  const data: HomeData = {
    firstName: ctx.fullName.split(" ")[0] || ctx.fullName,
    greeting: greeting(),
    dateLine: new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(new Date()),
    can: { inward: ctx.can("inward.create"), outward: ctx.can("outward.create"), billing: ctx.can("billing.manage"), reports: ctx.can("reports.view"), setup: ctx.can("location.manage"), requests: ctx.can("request.review") },
    summary: sum,
    setup: [
      { href: "/admin/storage", label: "Add your storage racks", done: sum.total_racks > 0 },
      { href: "/admin/products/new", label: "Add the products you store", done: sum.products > 0 },
      { href: "/admin/parties/new", label: "Add your first customer", done: sum.parties > 0 },
    ],
    chambers: sum.by_chamber.map((c) => ({
      id: c.id, name: c.name, bags: c.bags,
      floors: (fl.data ?? []).filter((f) => f.chamber_id === c.id).map((f) => ({ id: f.id, floor_no: f.floor_no, bags: sum.by_floor.find((x) => x.chamber_code === c.code && x.floor_no === f.floor_no)?.bags ?? 0 })),
    })),
    recent,
  };
  return (
    <>
      {denied && <p role="alert" className="mb-5 rounded-xl bg-out-soft px-4 py-3 text-base font-medium text-warning">You do not have permission to open that page.</p>}
      <HomeView d={data} />
    </>
  );
}
