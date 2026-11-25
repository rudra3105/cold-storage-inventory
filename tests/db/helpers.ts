import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";

export const pool = new Pool({
  connectionString: process.env.TEST_DB_URL ?? "postgres://cs_admin:cs_admin_pw@127.0.0.1:5432/coldstore_test",
  max: 40,
});

/** Run fn as a signed-in Supabase user (authenticated role + JWT claims), or anon when userId is null. */
export async function asUser<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, commit = true): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${userId ? "authenticated" : "anon"}`);
    if (userId) {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    }
    const r = await fn(c);
    await c.query(commit ? "commit" : "rollback");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export const rpc = async (c: PoolClient, fn: string, ...args: unknown[]) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(",");
  const params = args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a));
  const r = await c.query(`select public.${fn}(${ph}) as r`, params);
  return r.rows[0].r;
};

export type Fixture = Awaited<ReturnType<typeof buildFixture>>;

/** Users for every role, two customers (each with a login), products and racks. Created as superuser. */
export async function buildFixture() {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const mkUser = async (role: string, name: string) => {
    const id = randomUUID();
    await q("insert into auth.users (id, email) values ($1,$2)", [id, `${name.toLowerCase().replace(/\s/g, "")}-${id.slice(0, 4)}@t.local`]);
    await q("insert into public.profiles (id, full_name) values ($1,$2)", [id, name]);
    await q("insert into public.user_roles (user_id, role) values ($1,$2)", [id, role]);
    return id;
  };
  const admin = await mkUser("super_admin", "Owner");
  const manager = await mkUser("manager", "Manager");
  const staff = await mkUser("staff", "Staff");
  const accountant = await mkUser("accountant", "Accountant");
  const custA = await mkUser("customer", "Customer A Login");
  const custB = await mkUser("customer", "Customer B Login");

  const sfx = randomUUID().slice(0, 6);   // keeps names unique across test files
  const partyA = (await q("insert into public.parties (name, city, user_id) values ($2,'Surat',$1) returning id, party_code", [custA, `Alpha Traders ${sfx}`])).rows[0];
  const partyB = (await q("insert into public.parties (name, city, user_id) values ($2,'Vadodara',$1) returning id", [custB, `Beta Foods ${sfx}`])).rows[0];
  const potato = (await q("insert into public.products (name, category) values ($1,'Vegetable') returning id", [`Potato ${sfx}`])).rows[0].id;
  const onion = (await q("insert into public.products (name, category) values ($1,'Vegetable') returning id", [`Onion ${sfx}`])).rows[0].id;

  const rack = async (chamber: string, floorNo: number, code: string) =>
    (await q(
      `insert into public.racks (floor_id, code) select f.id, $3 from public.floors f join public.chambers c on c.id = f.chamber_id
       where c.code = $1 and f.floor_no = $2 returning id`, [chamber, floorNo, code])).rows[0].id as string;
  const rackA1 = await rack("A", 1, `R1-${sfx}`);
  const rackA2 = await rack("A", 1, `R2-${sfx}`);
  const rackB3 = await rack("B", 3, `R1-${sfx}`);

  return { admin, manager, staff, accountant, custA, custB, partyA: partyA.id as string, partyACode: partyA.party_code as string,
           partyB: partyB.id as string, potato: potato as string, onion: onion as string, rackA1, rackA2, rackB3 };
}

export const inward = (f: Fixture, o: Partial<{ party: string; product: string; rack: string; bags: number; kpb: number; date: string; cid: string }> = {}) => [
  { party_id: o.party ?? f.partyA, inward_date: o.date, vehicle_no: "gj 05 ab 1234", wb_kgs: 5000, remarks: "test", client_request_id: o.cid },
  [{ product_id: o.product ?? f.potato, rack_id: o.rack ?? f.rackA1, bags: o.bags ?? 100, kgs_per_bag: o.kpb ?? 50, wages_party: 10, wages_labour: 4 }],
] as const;

export const outward = (f: Fixture, o: Partial<{ party: string; product: string; rack: string; bags: number; kpb: number; date: string; cid: string; req: string }> = {}) => [
  { party_id: o.party ?? f.partyA, outward_date: o.date, vehicle_no: "GJ05XY9999", client_request_id: o.cid, outward_request_id: o.req },
  [{ product_id: o.product ?? f.potato, rack_id: o.rack ?? f.rackA1, bags: o.bags ?? 30, kgs_per_bag: o.kpb ?? 50 }],
] as const;

export async function balance(partyId: string, productId: string, rackId?: string) {
  const r = await pool.query(
    `select coalesce(sum(bags),0)::int as bags, coalesce(sum(kgs),0)::numeric as kgs from public.stock_movements
     where party_id=$1 and product_id=$2 and ($3::uuid is null or rack_id=$3)`, [partyId, productId, rackId ?? null]);
  return { bags: r.rows[0].bags as number, kgs: Number(r.rows[0].kgs) };
}
