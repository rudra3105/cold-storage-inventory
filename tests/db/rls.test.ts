import { beforeAll, describe, expect, it } from "vitest";
import { asUser, buildFixture, inward, outward, pool, rpc, type Fixture } from "./helpers";

let f: Fixture;
let outA: { id: string };
beforeAll(async () => {
  f = await buildFixture();
  await asUser(f.admin, (c) => rpc(c, "create_inward", ...inward(f, { bags: 100 })));
  await asUser(f.admin, (c) => rpc(c, "create_inward", ...inward(f, { party: f.partyB, bags: 40, product: f.onion, rack: f.rackB3 })));
  outA = await asUser(f.admin, (c) => rpc(c, "create_outward", ...outward(f, { bags: 10 })));
  await asUser(f.admin, (c) => rpc(c, "create_outward", ...outward(f, { party: f.partyB, bags: 5, product: f.onion, rack: f.rackB3 })));
  // billing rows inserted as superuser (RPCs arrive in Phase 4)
  await pool.query("insert into invoices (invoice_no, invoice_date, party_id, status) values ($1, current_date, $2, 'issued'), ($3, current_date, $4, 'issued'), (null, current_date, $2, 'draft')",
    [`T/${f.partyA}`, f.partyA, `T/${f.partyB}`, f.partyB]);
  await pool.query("insert into party_ledger (party_id, entry_date, entry_type, debit) values ($1, current_date, 'invoice', 100), ($2, current_date, 'invoice', 900)", [f.partyA, f.partyB]);
});

describe("11. customer data isolation (RLS)", () => {
  it("customer A sees only own party row, stock, documents and ledger", async () => {
    await asUser(f.custA, async (c) => {
      expect((await c.query("select id from parties")).rows.map((r) => r.id)).toEqual([f.partyA]);
      const bal = await c.query("select distinct party_id from stock_balances");
      expect(bal.rows.map((r) => r.party_id)).toEqual([f.partyA]);
      expect((await c.query("select distinct party_id from stock_movements")).rows.map((r) => r.party_id)).toEqual([f.partyA]);
      expect((await c.query("select distinct party_id from inward_transactions")).rows.map((r) => r.party_id)).toEqual([f.partyA]);
      expect((await c.query("select distinct party_id from outward_transactions")).rows.map((r) => r.party_id)).toEqual([f.partyA]);
      expect((await c.query("select count(*)::int n from inward_items")).rows[0].n).toBeGreaterThan(0);
      expect((await c.query("select count(*)::int n from inward_items i join inward_transactions t on t.id=i.inward_id where t.party_id<>$1", [f.partyA])).rows[0].n).toBe(0);
      expect((await c.query("select distinct party_id from party_ledger")).rows.map((r) => r.party_id)).toEqual([f.partyA]);
      const inv = await c.query("select party_id, status from invoices");
      expect(inv.rows.every((r) => r.party_id === f.partyA && r.status === "issued")).toBe(true);   // drafts hidden
    });
  });
  it("direct lookups of another customer's records return nothing", async () => {
    await asUser(f.custA, async (c) => {
      expect((await c.query("select * from parties where id=$1", [f.partyB])).rowCount).toBe(0);
      expect((await c.query("select * from stock_movements where party_id=$1", [f.partyB])).rowCount).toBe(0);
      expect((await c.query("select * from stock_balances where party_id=$1", [f.partyB])).rowCount).toBe(0);
      expect((await c.query("select * from party_ledger_balances where party_id=$1", [f.partyB])).rowCount).toBe(0);
      expect((await c.query("select * from inward_transactions where party_id=$1", [f.partyB])).rowCount).toBe(0);
    });
  });
  it("customer A's available quantity equals the ledger truth and matches what the admin sees", async () => {
    const mine = await asUser(f.custA, (c) => c.query("select sum(available_bags)::int b from stock_balances"));
    const admin = await asUser(f.admin, (c) => c.query("select sum(available_bags)::int b from stock_balances where party_id=$1", [f.partyA]));
    expect(mine.rows[0].b).toBe(90);
    expect(admin.rows[0].b).toBe(90);
  });
  it("customers cannot read internal-only data", async () => {
    for (const t of ["audit_logs", "stock_adjustments", "labour_records", "role_permissions", "party_rates", "charge_types", "doc_counters"]) {
      // each probe in its own transaction: a permission error aborts the transaction
      const r = await asUser(f.custA, (c) => c.query(`select * from ${t}`), false).then((x) => x.rowCount, (e) => `err:${e.message}`);
      expect(r === 0 || String(r).startsWith("err:"), `${t} leaked rows to a customer`).toBe(true);
    }
    await asUser(f.custA, async (c) => {
      expect((await c.query("select count(*)::int n from profiles")).rows[0].n).toBe(1);   // only themselves
      expect((await c.query("select count(*)::int n from user_roles")).rows[0].n).toBe(1);
    });
  });
  it("12. customer cannot modify stock, documents, parties or roles - by any route", async () => {
    const attempts: [string, unknown[]][] = [
      ["insert into stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, inward_id) select 'inward', current_date, party_id, product_id, rack_id, 999, 999, inward_id from stock_movements limit 1", []],
      ["update stock_movements set bags = 0", []],
      ["delete from stock_movements", []],
      ["update inward_transactions set status='cancelled'", []],
      ["delete from outward_transactions", []],
      ["update parties set opening_balance = -1000000 where id=$1", [f.partyA]],
      ["update parties set user_id = $1 where id=$2", [f.custA, f.partyB]],
      ["insert into user_roles (user_id, role) values ($1,'super_admin')", [f.custA]],
      ["update user_roles set role='super_admin'", []],
      ["update role_permissions set allowed=true", []],
      ["insert into invoices (invoice_date, party_id) values (current_date, $1)", [f.partyA]],
      ["insert into party_ledger (party_id, entry_date, entry_type, credit) values ($1, current_date, 'receipt', 100)", [f.partyA]],
    ];
    for (const [sql, p] of attempts) {
      const res = await asUser(f.custA, (c) => c.query(sql, p), false).then((r) => ({ n: r.rowCount ?? 0 }), (e) => ({ err: String(e.message) }));
      // either rejected outright, or (RLS) matched zero rows
      expect("err" in res || res.n === 0, `should not succeed: ${sql}`).toBe(true);
    }
    for (const [fn, args] of [
      ["create_inward", [{ party_id: f.partyA }, [{ product_id: f.potato, rack_id: f.rackA1, bags: 5, kgs_per_bag: 5 }]]],
      ["create_outward", [{ party_id: f.partyA }, [{ product_id: f.potato, rack_id: f.rackA1, bags: 1, kgs_per_bag: 50 }]]],
      ["cancel_outward", [outA.id, "customer trying to cancel"]],
      ["post_stock_adjustment", [f.partyA, f.potato, f.rackA1, 100, 100, null, "fake stock please"]],
    ] as const) {
      await expect(asUser(f.custA, (c) => rpc(c, fn, ...args)), fn).rejects.toThrow(/Permission denied/);
    }
    // stock untouched
    expect((await pool.query("select coalesce(sum(bags),0)::int b from stock_movements where party_id=$1", [f.partyA])).rows[0].b).toBe(90);
  });
  it("an inactive customer account sees nothing", async () => {
    await pool.query("update parties set is_active=false where id=$1", [f.partyB]);
    try {
      await asUser(f.custB, async (c) => {
        expect((await c.query("select * from parties")).rowCount).toBe(0);
        expect((await c.query("select * from stock_balances")).rowCount).toBe(0);
      });
    } finally { await pool.query("update parties set is_active=true where id=$1", [f.partyB]); }
  });
  it("a customer cannot be re-pointed at someone else's party", async () => {
    await expect(pool.query("update parties set user_id=$1 where id=$2", [f.custA, f.partyB])).rejects.toThrow(/unique/);
  });
});

describe("internal roles", () => {
  it("staff see all operational stock but not financial data", async () => {
    await asUser(f.staff, async (c) => {
      expect((await c.query("select distinct party_id from stock_balances")).rowCount).toBeGreaterThanOrEqual(2);
      expect((await c.query("select * from party_ledger")).rowCount).toBe(0);
      expect((await c.query("select * from invoices")).rowCount).toBe(0);
      expect((await c.query("select * from audit_logs")).rowCount).toBe(0);
    });
  });
  it("accountant sees billing data; only the owner reads audit logs", async () => {
    await asUser(f.accountant, async (c) => {
      expect((await c.query("select * from party_ledger")).rowCount).toBe(2);
      expect((await c.query("select * from audit_logs")).rowCount).toBe(0);
    });
    await asUser(f.admin, async (c) => expect((await c.query("select * from audit_logs")).rowCount).toBeGreaterThan(0));
  });
  it("audit log captured who created the inward and what changed on master edits", async () => {
    const r = await pool.query("select user_id from audit_logs where table_name='inward_transactions' and action='insert' and new_data->>'party_id'=$1 limit 1", [f.partyA]);
    expect(r.rows[0].user_id).toBe(f.admin);
    await asUser(f.admin, (c) => c.query("update parties set remarks='audited' where id=$1", [f.partyA]));
    const a = await pool.query("select old_data->>'remarks' o, new_data->>'remarks' n from audit_logs where table_name='parties' and record_id=$1 and action='update' order by id desc limit 1", [f.partyA]);
    expect(a.rows[0]).toEqual({ o: null, n: "audited" });
  });
});

describe("customer outward requests", () => {
  it("submitting a request never deducts stock; approval + outward does; cancelling outward re-opens the request", async () => {
    const bal = async () => (await pool.query("select coalesce(sum(bags),0)::int b from stock_movements where party_id=$1 and product_id=$2", [f.partyA, f.potato])).rows[0].b as number;
    const b0 = await bal();
    const req = await asUser(f.custA, (c) => rpc(c, "create_outward_request", f.potato, 20, null, "need on Monday"));
    expect(req.request_no).toMatch(/^REQ\//);
    expect(await bal()).toBe(b0);                                                      // unchanged
    expect((await pool.query("select count(*)::int n from notifications where link='/admin/requests'")).rows[0].n).toBeGreaterThan(0);

    await expect(asUser(f.custA, (c) => rpc(c, "create_outward_request", f.potato, b0 - 19, null, null))).rejects.toThrow(/exceeds your available/); // open request counted
    await expect(asUser(f.custA, (c) => rpc(c, "review_outward_request", req.id, true, null))).rejects.toThrow(/Permission denied/);   // customer cannot self-approve
    await expect(asUser(f.admin, (c) => rpc(c, "create_outward", ...outward(f, { bags: 1, req: req.id })))).rejects.toThrow(/approved request/);

    await asUser(f.manager, (c) => rpc(c, "review_outward_request", req.id, true, "ok"));
    expect(await bal()).toBe(b0);                                                      // still unchanged
    const out = await asUser(f.staff, (c) => rpc(c, "create_outward", ...outward(f, { bags: 20, req: req.id })));
    expect(await bal()).toBe(b0 - 20);
    expect((await pool.query("select status from outward_requests where id=$1", [req.id])).rows[0].status).toBe("fulfilled");

    await asUser(f.admin, (c) => rpc(c, "cancel_outward", out.id, "customer changed plan"));
    expect(await bal()).toBe(b0);
    expect((await pool.query("select status from outward_requests where id=$1", [req.id])).rows[0].status).toBe("approved");
  });
  it("customers only see their own requests and cannot request another party's stock", async () => {
    await asUser(f.custB, (c) => rpc(c, "create_outward_request", f.onion, 5, null, null));
    const mine = await asUser(f.custA, (c) => c.query("select distinct party_id from outward_requests"));
    expect(mine.rows.map((r) => r.party_id)).toEqual([f.partyA]);
    await expect(asUser(f.custA, (c) => rpc(c, "create_outward_request", f.onion, 5, null, null))).rejects.toThrow(/exceeds your available/);
  });
  it("rejection needs a reason; decided requests cannot be re-decided; customer can cancel own pending only", async () => {
    const r = await asUser(f.custA, (c) => rpc(c, "create_outward_request", f.potato, 1, null, null));
    await expect(asUser(f.admin, (c) => rpc(c, "review_outward_request", r.id, false, ""))).rejects.toThrow(/reason/);
    await asUser(f.admin, (c) => rpc(c, "review_outward_request", r.id, false, "not enough notice"));
    await expect(asUser(f.admin, (c) => rpc(c, "review_outward_request", r.id, true, null))).rejects.toThrow(/already rejected/);
    await expect(asUser(f.custA, (c) => rpc(c, "cancel_outward_request", r.id))).rejects.toThrow(/Only pending/);
    const r2 = await asUser(f.custA, (c) => rpc(c, "create_outward_request", f.potato, 1, null, null));
    await expect(asUser(f.custB, (c) => rpc(c, "cancel_outward_request", r2.id))).rejects.toThrow(/not found/i);
    await asUser(f.custA, (c) => rpc(c, "cancel_outward_request", r2.id));
  });
});

describe("dashboard_summary()", () => {
  it("matches the ledger for the owner and is scoped to the caller for a customer", async () => {
    const admin = (await asUser(f.admin, (c) => c.query("select public.dashboard_summary() s"))).rows[0].s;
    const ledger = (await pool.query("select sum(bags)::int b, sum(kgs)::numeric k from stock_movements")).rows[0];
    expect(admin.stock_bags).toBe(ledger.b);
    expect(Number(admin.stock_kgs)).toBe(Number(ledger.k));
    expect(admin.by_chamber.reduce((s: number, c: { bags: number }) => s + c.bags, 0)).toBe(ledger.b);
    expect(admin.by_floor.reduce((s: number, c: { bags: number }) => s + c.bags, 0)).toBe(ledger.b);
    expect(admin.by_floor).toHaveLength(15);                      // 3 chambers x 5 floors
    const mine = (await asUser(f.custA, (c) => c.query("select public.dashboard_summary() s"))).rows[0].s;
    const myLedger = (await pool.query("select sum(bags)::int b from stock_movements where party_id=$1", [f.partyA])).rows[0].b;
    expect(mine.stock_bags).toBe(myLedger);
    expect(mine.stock_bags).toBeLessThan(admin.stock_bags);
  });
});
