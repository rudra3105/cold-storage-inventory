import { beforeAll, describe, expect, it } from "vitest";
import { asUser, balance, buildFixture, inward, outward, pool, rpc, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => { f = await buildFixture(); });

const doInward = (user: string, ...a: Parameters<typeof inward>[1][]) => asUser(user, (c) => rpc(c, "create_inward", ...inward(f, a[0])));
const doOutward = (user: string, o?: Parameters<typeof outward>[1]) => asUser(user, (c) => rpc(c, "create_outward", ...outward(f, o)));

describe("masters", () => {
  it("1/2. creates party and product; codes are generated; party is unique by name+city", async () => {
    const r = await asUser(f.admin, async (c) => {
      const p = await c.query("insert into parties (name, city, gst_number) values ('Gamma Agro','Anand','24ABCDE1234F1Z5') returning party_code");
      const pr = await c.query("insert into products (name) values ('Garlic Test') returning product_code");
      return { p: p.rows[0].party_code, pr: pr.rows[0].product_code };
    });
    expect(r.p).toMatch(/^P-\d{4}$/);
    expect(r.pr).toMatch(/^PR-\d{4}$/);
    await expect(asUser(f.admin, (c) => c.query("insert into parties (name, city) values ('gamma agro ','ANAND')"))).rejects.toThrow(/parties_name_city_uq/);
    await expect(asUser(f.admin, (c) => c.query("insert into parties (name, gst_number) values ('Bad Gst','123')"))).rejects.toThrow(/gst_number/);
  });
  it("staff cannot create parties by default (permission-driven)", async () => {
    await expect(asUser(f.staff, (c) => c.query("insert into parties (name) values ('Nope Ltd')"))).rejects.toThrow(/row-level security/);
  });
});

describe("inward", () => {
  it("3/4. creates inward, computes total kgs, increases stock", async () => {
    const before = await balance(f.partyA, f.potato);
    const res = await doInward(f.staff);
    expect(res.inward_no).toMatch(/^INW\/\d{4}-\d{2}\/\d{5}$/);
    expect(res.total_bags).toBe(100);
    expect(Number(res.total_kgs)).toBe(5000);
    const after = await balance(f.partyA, f.potato);
    expect(after.bags - before.bags).toBe(100);
    expect(after.kgs - before.kgs).toBe(5000);
    const row = await pool.query("select i.total_kgs, i.wages_party, t.vehicle_no from inward_items i join inward_transactions t on t.id=i.inward_id where t.id=$1", [res.id]);
    expect(Number(row.rows[0].total_kgs)).toBe(5000);
    expect(row.rows[0].vehicle_no).toBe("GJ05AB1234");   // normalised
  });
  it("supports multiple product lines in one inward, each with its own location", async () => {
    const res = await asUser(f.staff, (c) => rpc(c, "create_inward",
      { party_id: f.partyA }, [
        { product_id: f.potato, rack_id: f.rackA1, bags: 10, kgs_per_bag: 50 },
        { product_id: f.onion, rack_id: f.rackA2, bags: 20, kgs_per_bag: 40, wages_labour: 8 },
      ]));
    expect(res.total_bags).toBe(30);
    expect(Number(res.total_kgs)).toBe(500 + 800);
    expect((await balance(f.partyA, f.onion, f.rackA2)).bags).toBe(20);
  });
  it("rejects invalid inward and does not consume a document number", async () => {
    const counter = async () => Number((await pool.query("select coalesce(max(last_no),0) n from doc_counters where doc_type='inward'")).rows[0].n);
    const n0 = await counter();
    for (const [h, items, msg] of [
      [{ party_id: f.partyA }, [], /at least one/i],
      [{ party_id: f.partyA }, [{ product_id: f.potato, rack_id: f.rackA1, bags: 0, kgs_per_bag: 50 }], /bags must be/i],
      [{ party_id: f.partyA }, [{ product_id: f.potato, rack_id: f.rackA1, bags: 5.5, kgs_per_bag: 50 }], /whole number/i],
      [{ party_id: f.partyA }, [{ product_id: f.potato, rack_id: f.rackA1, bags: 5, kgs_per_bag: -1 }], /kgs per bag/i],
      [{ party_id: f.partyA }, [{ product_id: f.potato, rack_id: f.rackA1, bags: 5, kgs_per_bag: 50, wages_party: -5 }], /wages/i],
      [{ party_id: f.partyA, inward_date: "2999-01-01" }, [{ product_id: f.potato, rack_id: f.rackA1, bags: 5, kgs_per_bag: 50 }], /future/i],
      [{ party_id: null }, [{ product_id: f.potato, rack_id: f.rackA1, bags: 5, kgs_per_bag: 50 }], /party/i],
      [{ party_id: f.partyA }, [{ product_id: f.potato, rack_id: null, bags: 5, kgs_per_bag: 50 }], /rack/i],
      [{ party_id: f.partyA }, [{ product_id: f.potato, rack_id: f.rackA1, bags: "abc", kgs_per_bag: 50 }], /invalid input/i],
    ] as const) {
      await expect(asUser(f.admin, (c) => rpc(c, "create_inward", h, items))).rejects.toThrow(msg);
    }
    expect(await counter()).toBe(n0);
  });
  it("is idempotent for a retried submission (same client_request_id)", async () => {
    const cid = crypto.randomUUID();
    const before = await balance(f.partyA, f.potato);
    const a = await doInward(f.staff, { cid, bags: 7 });
    const b = await doInward(f.staff, { cid, bags: 7 });
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect((await balance(f.partyA, f.potato)).bags - before.bags).toBe(7);
  });
});

describe("outward", () => {
  it("5. partial outward decreases stock and keeps history", async () => {
    const before = await balance(f.partyA, f.potato, f.rackA1);
    const res = await doOutward(f.staff, { bags: 30 });
    expect(res.outward_no).toMatch(/^OUT\//);
    const after = await balance(f.partyA, f.potato, f.rackA1);
    expect(before.bags - after.bags).toBe(30);
    expect(before.kgs - after.kgs).toBe(1500);
    const hist = await pool.query("select movement_type, bags from stock_movements where outward_id=$1", [res.id]);
    expect(hist.rows).toEqual([{ movement_type: "outward", bags: -30 }]);
  });
  it("6. outward beyond available stock is rejected; nothing written, number not burned", async () => {
    const avail = await balance(f.partyA, f.potato, f.rackA1);
    const n0 = (await pool.query("select count(*)::int n from outward_transactions")).rows[0].n;
    const c0 = Number((await pool.query("select coalesce(max(last_no),0) n from doc_counters where doc_type='outward'")).rows[0].n);
    await expect(doOutward(f.staff, { bags: avail.bags + 1 })).rejects.toThrow(/Insufficient stock/);
    expect((await pool.query("select count(*)::int n from outward_transactions")).rows[0].n).toBe(n0);
    expect(Number((await pool.query("select coalesce(max(last_no),0) n from doc_counters where doc_type='outward'")).rows[0].n)).toBe(c0);
    expect(await balance(f.partyA, f.potato, f.rackA1)).toEqual(avail);
  });
  it("rejects dispatch exceeding available KGS even if bags are available", async () => {
    const avail = await balance(f.partyA, f.potato, f.rackA1);
    await expect(doOutward(f.staff, { bags: 1, kpb: avail.kgs + 1 })).rejects.toThrow(/Insufficient stock/);
  });
  it("cannot dispatch another party's stock or stock from the wrong rack", async () => {
    await expect(doOutward(f.staff, { party: f.partyB, bags: 1 })).rejects.toThrow(/Insufficient stock/);
    await expect(doOutward(f.staff, { rack: f.rackB3, bags: 1 })).rejects.toThrow(/Insufficient stock/);
  });
  it("dispatching exactly everything leaves zero, never negative", async () => {
    const prod = (await pool.query("insert into products (name) values ($1) returning id", [`Exact ${Date.now()}`])).rows[0].id;
    await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA2, bags: 12, kgs_per_bag: 25 }]));
    await asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA2, bags: 12, kgs_per_bag: 25 }]));
    expect(await balance(f.partyA, prod)).toEqual({ bags: 0, kgs: 0 });
    await expect(asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA2, bags: 1, kgs_per_bag: 25 }]))).rejects.toThrow(/Insufficient/);
  });
  it("one outward with two lines drawing from the same position is checked in aggregate", async () => {
    const prod = (await pool.query("insert into products (name) values ($1) returning id", [`Agg ${Date.now()}`])).rows[0].id;
    await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA1, bags: 10, kgs_per_bag: 10 }]));
    await expect(asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA }, [
      { product_id: prod, rack_id: f.rackA1, bags: 6, kgs_per_bag: 10 }, { product_id: prod, rack_id: f.rackA1, bags: 6, kgs_per_bag: 10 }]))).rejects.toThrow(/Insufficient/);
    expect((await balance(f.partyA, prod)).bags).toBe(10);
  });
  it("rejects back-dated outward that would precede the inward (as-of-date balance)", async () => {
    const prod = (await pool.query("insert into products (name) values ($1) returning id", [`Dated ${Date.now()}`])).rows[0].id;
    const today = (await pool.query("select app.business_today() d")).rows[0].d as Date;
    const iso = (d: Date) => d.toLocaleDateString("en-CA");
    const earlier = new Date(today); earlier.setDate(earlier.getDate() - 10);
    const mid = new Date(today); mid.setDate(mid.getDate() - 5);
    await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA, inward_date: iso(mid) }, [{ product_id: prod, rack_id: f.rackA1, bags: 10, kgs_per_bag: 10 }]));
    await expect(asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA, outward_date: iso(earlier) }, [{ product_id: prod, rack_id: f.rackA1, bags: 5, kgs_per_bag: 10 }]))).rejects.toThrow(/Insufficient stock/);
    await asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA, outward_date: iso(mid) }, [{ product_id: prod, rack_id: f.rackA1, bags: 5, kgs_per_bag: 10 }]));
  });
});

describe("reports consistency", () => {
  it("7. party-wise, product-wise and floor-wise totals all agree with the ledger", async () => {
    const total = (await pool.query("select sum(bags)::int b, sum(kgs)::numeric k from stock_movements")).rows[0];
    const byView = (await pool.query("select sum(available_bags)::int b, sum(available_kgs)::numeric k from stock_balances")).rows[0];
    expect(byView.b).toBe(total.b);
    expect(Number(byView.k)).toBe(Number(total.k));
    const party = (await pool.query("select party_id, sum(available_bags)::int b from stock_balances group by 1")).rows;
    expect(party.reduce((s, r) => s + r.b, 0)).toBe(total.b);
    const floor = (await pool.query("select floor_id, sum(available_bags)::int b from stock_balances group by 1")).rows;
    expect(floor.reduce((s, r) => s + r.b, 0)).toBe(total.b);
    const a1 = (await pool.query(
      `select coalesce(sum(available_bags),0)::int b from stock_balances sb join floors fl on fl.id = sb.floor_id join chambers c on c.id = fl.chamber_id
       where c.code='A' and fl.floor_no=1 and sb.party_id=$1 and sb.product_id=$2`, [f.partyA, f.potato])).rows[0].b;
    expect(a1).toBe((await balance(f.partyA, f.potato)).bags);
    // inward - outward + adjustments == available for every row
    const bad = await pool.query("select 1 from stock_balances where inward_bags - outward_bags + adjustment_bags <> available_bags or inward_kgs - outward_kgs + adjustment_kgs <> available_kgs");
    expect(bad.rowCount).toBe(0);
  });
});

describe("cancellation / reversal", () => {
  it("13. cancelling an outward restores stock, leaves audit + reversal rows, and cannot be repeated", async () => {
    const before = await balance(f.partyA, f.potato, f.rackA1);
    const out = await doOutward(f.staff.length ? f.admin : f.admin, { bags: 5 });
    expect((await balance(f.partyA, f.potato, f.rackA1)).bags).toBe(before.bags - 5);
    await asUser(f.admin, (c) => rpc(c, "cancel_outward", out.id, "Wrong party dispatched"));
    expect(await balance(f.partyA, f.potato, f.rackA1)).toEqual(before);
    const mv = await pool.query("select movement_type, bags from stock_movements where outward_id=$1 order by created_at, bags", [out.id]);
    expect(mv.rows.map((r) => r.movement_type).sort()).toEqual(["outward", "outward_reversal"]);
    const audit = await pool.query("select meta from audit_logs where action='cancel' and record_id=$1", [out.id]);
    expect(audit.rows[0].meta.reason).toBe("Wrong party dispatched");
    await expect(asUser(f.admin, (c) => rpc(c, "cancel_outward", out.id, "again please"))).rejects.toThrow(/already cancelled/);
    expect((await pool.query("select status from labour_records where outward_id=$1", [out.id])).rows[0].status).toBe("cancelled");
  });
  it("cancel requires a reason", async () => {
    const out = await doOutward(f.admin, { bags: 1 });
    await expect(asUser(f.admin, (c) => rpc(c, "cancel_outward", out.id, " "))).rejects.toThrow(/reason/i);
  });
  it("cancelling an inward whose stock was already dispatched is rejected (stock stays correct)", async () => {
    const prod = (await pool.query("insert into products (name) values ($1) returning id", [`Cxl ${Date.now()}`])).rows[0].id;
    const inw = await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA1, bags: 10, kgs_per_bag: 10 }]));
    await asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA1, bags: 4, kgs_per_bag: 10 }]));
    await expect(asUser(f.admin, (c) => rpc(c, "cancel_inward", inw.id, "entered twice"))).rejects.toThrow(/Insufficient stock/);
    expect((await balance(f.partyA, prod)).bags).toBe(6);
    expect((await pool.query("select status from inward_transactions where id=$1", [inw.id])).rows[0].status).toBe("active");
  });
  it("cancelling an untouched inward removes its stock exactly", async () => {
    const prod = (await pool.query("insert into products (name) values ($1) returning id", [`Cxl2 ${Date.now()}`])).rows[0].id;
    const inw = await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA1, bags: 10, kgs_per_bag: 10 }]));
    await asUser(f.admin, (c) => rpc(c, "cancel_inward", inw.id, "entered in error"));
    expect(await balance(f.partyA, prod)).toEqual({ bags: 0, kgs: 0 });
  });
});

describe("ledger integrity", () => {
  it("stock_movements is append-only even for a superuser", async () => {
    await expect(pool.query("update stock_movements set bags = bags + 1")).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from stock_movements")).rejects.toThrow(/append-only/);
    await expect(pool.query("truncate stock_movements")).rejects.toThrow(/append-only/);
    await expect(pool.query("update audit_logs set action='x'")).rejects.toThrow(/append-only/);
  });
  it("database refuses a hand-made negative movement (guard works below the RPC layer)", async () => {
    await expect(pool.query(
      `insert into stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, outward_id)
       select 'outward', current_date, $1, $2, $3, -999999, -999999, o.id from outward_transactions o limit 1`,
      [f.partyA, f.potato, f.rackA1])).rejects.toThrow(/Insufficient stock/);
  });
  it("authenticated users cannot write ledger or documents directly, whatever their role", async () => {
    for (const u of [f.admin, f.manager, f.staff, f.accountant, f.custA]) {
      await expect(asUser(u, (c) => c.query("insert into stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, inward_id) select 'inward', current_date, party_id, $1, $2, 1000, 1000, id from inward_transactions limit 1", [f.potato, f.rackA1]))).rejects.toThrow(/permission denied/);
      await expect(asUser(u, (c) => c.query("update inward_transactions set status='cancelled'"))).rejects.toThrow(/permission denied/);
      await expect(asUser(u, (c) => c.query("delete from outward_items"))).rejects.toThrow(/permission denied/);
    }
  });
  it("stock adjustments need permission and a reason; they hit the ledger", async () => {
    await expect(asUser(f.staff, (c) => rpc(c, "post_stock_adjustment", f.partyA, f.potato, f.rackA1, -1, -50, null, "damaged bag"))).rejects.toThrow(/Permission denied/);
    await expect(asUser(f.admin, (c) => rpc(c, "post_stock_adjustment", f.partyA, f.potato, f.rackA1, -1, -50, null, "x"))).rejects.toThrow(/reason/i);
    const before = await balance(f.partyA, f.potato, f.rackA1);
    await asUser(f.admin, (c) => rpc(c, "post_stock_adjustment", f.partyA, f.potato, f.rackA1, -1, -50, null, "damaged bag written off"));
    const after = await balance(f.partyA, f.potato, f.rackA1);
    expect(before.bags - after.bags).toBe(1);
    await expect(asUser(f.admin, (c) => rpc(c, "post_stock_adjustment", f.partyA, f.potato, f.rackA1, -(after.bags + 1), -1, null, "too much removal"))).rejects.toThrow(/Insufficient stock/);
  });
  it("racks holding stock cannot be deactivated or moved", async () => {
    await expect(asUser(f.admin, (c) => c.query("update racks set is_active=false where id=$1", [f.rackA1]))).rejects.toThrow(/still holds/);
    await expect(asUser(f.admin, (c) => c.query("update racks set floor_id=(select id from floors where id<>floor_id limit 1) where id=$1", [f.rackA1]))).rejects.toThrow(/cannot be moved/);
    const empty = (await pool.query("insert into racks (floor_id, code) select floor_id, 'EMPTY-' || gen_random_uuid() from racks where id=$1 returning id", [f.rackA1])).rows[0].id;
    await asUser(f.admin, (c) => c.query("update racks set is_active=false where id=$1", [empty]));
    await expect(asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [{ product_id: f.potato, rack_id: empty, bags: 1, kgs_per_bag: 1 }]))).rejects.toThrow(/active chamber/);
  });
});

describe("concurrency", () => {
  it("14. concurrent outwards can never oversell (20 racing dispatches of 30 bags vs 100 in stock)", async () => {
    const prod = (await pool.query("insert into products (name) values ($1) returning id", [`Race ${Date.now()}`])).rows[0].id;
    await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA2, bags: 100, kgs_per_bag: 10 }]));
    // barrier: every transaction is open (own connection) before any of them fires, so they truly overlap
    const N = 20;
    let arrived = 0; let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const barrier = async () => { if (++arrived === N) release(); await gate; };
    const attempts = Array.from({ length: N }, () =>
      asUser(f.staff, async (c) => { await barrier(); return rpc(c, "create_outward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA2, bags: 30, kgs_per_bag: 10 }]); })
        .then(() => "ok", (e) => String(e.message)));
    const results = await Promise.all(attempts);
    const ok = results.filter((r) => r === "ok").length;
    expect(ok).toBe(3);                                              // 3 x 30 = 90 <= 100 < 120
    expect(results.filter((r) => r !== "ok").every((m) => /Insufficient stock/.test(m))).toBe(true);
    expect(await balance(f.partyA, prod)).toEqual({ bags: 10, kgs: 100 });
  });
  it("concurrent outward vs cancel-inward on the same stock stays consistent", async () => {
    const prod = (await pool.query("insert into products (name) values ($1) returning id", [`Race2 ${Date.now()}`])).rows[0].id;
    const inw = await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA2, bags: 10, kgs_per_bag: 10 }]));
    const [a, b] = await Promise.all([
      asUser(f.admin, (c) => rpc(c, "cancel_inward", inw.id, "race cancel")).then(() => "ok", (e) => String(e.message)),
      asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA2, bags: 10, kgs_per_bag: 10 }])).then(() => "ok", (e) => String(e.message)),
    ]);
    expect([a, b].filter((x) => x === "ok").length).toBe(1);        // exactly one wins
    const bal = await balance(f.partyA, prod);
    expect(bal.bags).toBe(0);
    expect(bal.kgs).toBe(0);
  });
  it("concurrent outward vs negative adjustment on the same stock: exactly one wins, never negative", async () => {
    for (let round = 0; round < 5; round++) {
      const prod = (await pool.query("insert into products (name) values ($1) returning id", [`Race3 ${round} ${Date.now()}`])).rows[0].id;
      await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA2, bags: 10, kgs_per_bag: 10 }]));
      let arrived = 0; let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      const barrier = async () => { if (++arrived === 2) release(); await gate; };
      const [a, b] = await Promise.all([
        asUser(f.admin, async (c) => { await barrier(); return rpc(c, "post_stock_adjustment", f.partyA, prod, f.rackA2, -10, -100, null, "write-off race test"); }).then(() => "ok", (e) => String(e.message)),
        asUser(f.admin, async (c) => { await barrier(); return rpc(c, "create_outward", { party_id: f.partyA }, [{ product_id: prod, rack_id: f.rackA2, bags: 10, kgs_per_bag: 10 }]); }).then(() => "ok", (e) => String(e.message)),
      ]);
      expect([a, b].filter((x) => x === "ok").length, `round ${round}: ${a} | ${b}`).toBe(1);
      expect(await balance(f.partyA, prod)).toEqual({ bags: 0, kgs: 0 });
    }
  });
  it("concurrent inwards get unique, gapless numbers", async () => {
    const rs = await Promise.all(Array.from({ length: 15 }, () => doInward(f.staff, { bags: 1 })));
    const nums = rs.map((r) => Number(r.inward_no.split("/")[2])).sort((x, y) => x - y);
    expect(new Set(nums).size).toBe(15);
    expect(nums[14] - nums[0]).toBe(14);
  });
});

describe("permissions are configurable", () => {
  it("staff cannot cancel by default; granting the permission enables it; revoking disables it", async () => {
    const inw = await doInward(f.staff, { bags: 2 });
    await expect(asUser(f.staff, (c) => rpc(c, "cancel_inward", inw.id, "mistake entry"))).rejects.toThrow(/Permission denied: inward.cancel/);
    await pool.query("update role_permissions set allowed=true where role='staff' and permission='inward.cancel'");
    await asUser(f.staff, (c) => rpc(c, "cancel_inward", inw.id, "mistake entry"));
    await pool.query("update role_permissions set allowed=false where role='staff' and permission='inward.cancel'");
    const inw2 = await doInward(f.staff, { bags: 2 });
    await expect(asUser(f.staff, (c) => rpc(c, "cancel_inward", inw2.id, "mistake entry"))).rejects.toThrow(/Permission denied/);
  });
  it("accountant cannot create stock transactions; deactivated users lose all access", async () => {
    await expect(doInward(f.accountant)).rejects.toThrow(/Permission denied/);
    const u = (await pool.query("select user_id from user_roles where role='staff' limit 1")).rows[0].user_id;
    await pool.query("update profiles set is_active=false where id=$1", [u]);
    await expect(doInward(u)).rejects.toThrow(/Permission denied|Authentication/);
    expect((await asUser(u, (c) => c.query("select 1 from parties"))).rowCount).toBe(0);
    await pool.query("update profiles set is_active=true where id=$1", [u]);
  });
  it("anonymous callers get nothing", async () => {
    await expect(asUser(null, (c) => c.query("select * from parties"))).rejects.toThrow(/permission denied/);
    await expect(asUser(null, (c) => rpc(c, "create_inward", {}, []))).rejects.toThrow(/permission denied/);
  });
});
