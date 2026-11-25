import { beforeAll, describe, expect, it } from "vitest";
import { asUser, buildFixture, inward, outward, pool, rpc, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => {
  f = await buildFixture();
  await pool.query("update parties set opening_balance = 1000 where id = $1", [f.partyA]);
});
const bal = async (party: string) => Number((await pool.query("select balance from party_ledger_balances where party_id=$1", [party])).rows[0].balance);
const mkInvoice = async (party = f.partyA, items = [{ description: "Storage", quantity: 10, rate: 12.5, tax_percent: 5 }]) => {
  const d = await asUser(f.accountant, (c) => rpc(c, "save_invoice", null, { party_id: party, invoice_date: null }, items));
  return d.id as string;
};

describe("invoices", () => {
  it("computes line amount and tax in the database; draft has no ledger effect and no number", async () => {
    const id = await mkInvoice();
    const b = (await pool.query("select * from invoice_balances where invoice_id=$1", [id])).rows[0];
    expect(Number(b.subtotal)).toBe(125); expect(Number(b.tax_total)).toBe(6.25); expect(Number(b.total)).toBe(131.25);
    expect(b.invoice_no).toBeNull(); expect(b.payment_status).toBe("draft");
    expect(await bal(f.partyA)).toBe(1000);
  });
  it("issue assigns a number and debits the ledger; issued invoices cannot be edited", async () => {
    const id = await mkInvoice();
    const r = await asUser(f.accountant, (c) => rpc(c, "issue_invoice", id));
    expect(r.invoice_no).toMatch(/^INV\/\d{4}-\d{2}\/\d{5}$/);
    expect(Number(r.total)).toBe(131.25);
    expect(Number((await pool.query("select coalesce(sum(debit),0) d from party_ledger where invoice_id=$1", [id])).rows[0].d)).toBe(131.25);
    await expect(asUser(f.accountant, (c) => rpc(c, "save_invoice", id, { party_id: f.partyA }, [{ description: "x", quantity: 1, rate: 1 }]))).rejects.toThrow(/Only a draft/);
    await expect(asUser(f.accountant, (c) => rpc(c, "issue_invoice", id))).rejects.toThrow(/already issued/);
  });
  it("rejects bad lines and zero totals", async () => {
    await expect(asUser(f.accountant, (c) => rpc(c, "save_invoice", null, { party_id: f.partyA }, [{ description: "", quantity: 1, rate: 1 }]))).rejects.toThrow(/description/);
    await expect(asUser(f.accountant, (c) => rpc(c, "save_invoice", null, { party_id: f.partyA }, [{ description: "a", quantity: -1, rate: 1 }]))).rejects.toThrow(/0 or more/);
    await expect(asUser(f.accountant, (c) => rpc(c, "save_invoice", null, { party_id: f.partyA }, [{ description: "a", quantity: 1, rate: 1, tax_percent: 150 }]))).rejects.toThrow(/between 0 and 100/);
    const zero = await mkInvoice(f.partyA, [{ description: "free", quantity: 5, rate: 0, tax_percent: 0 }]);
    await expect(asUser(f.accountant, (c) => rpc(c, "issue_invoice", zero))).rejects.toThrow(/greater than 0/);
  });
  it("only billing.manage can invoice; staff and customers cannot", async () => {
    for (const u of [f.staff, f.custA, f.manager]) {
      await expect(asUser(u, (c) => rpc(c, "save_invoice", null, { party_id: f.partyA }, [{ description: "a", quantity: 1, rate: 1 }]))).rejects.toThrow(/Permission denied/);
    }
  });
});

describe("receipts, allocation and ledger", () => {
  it("allocates to invoices, tracks partial/paid, blocks over-allocation, and the ledger always reconciles", async () => {
    const start = await bal(f.partyB);
    const inv = await mkInvoice(f.partyB, [{ description: "Storage", quantity: 100, rate: 2, tax_percent: 0 }]);   // 200
    await asUser(f.accountant, (c) => rpc(c, "issue_invoice", inv));
    expect(await bal(f.partyB)).toBe(start + 200);

    const r1 = await asUser(f.accountant, (c) => rpc(c, "create_receipt", { party_id: f.partyB, amount: 80, payment_mode: "upi", reference_no: "UTR1" }, [{ invoice_id: inv, amount: 80 }]));
    expect(r1.receipt_no).toMatch(/^RCP\//);
    let b = (await pool.query("select paid, outstanding, payment_status from invoice_balances where invoice_id=$1", [inv])).rows[0];
    expect([Number(b.paid), Number(b.outstanding), b.payment_status]).toEqual([80, 120, "partial"]);
    expect(await bal(f.partyB)).toBe(start + 120);

    await expect(asUser(f.accountant, (c) => rpc(c, "create_receipt", { party_id: f.partyB, amount: 500, payment_mode: "cash" }, [{ invoice_id: inv, amount: 121 }]))).rejects.toThrow(/exceeds the outstanding/);
    await expect(asUser(f.accountant, (c) => rpc(c, "create_receipt", { party_id: f.partyB, amount: 50, payment_mode: "cash" }, [{ invoice_id: inv, amount: 60 }]))).rejects.toThrow(/exceed the receipt amount/);
    await expect(asUser(f.accountant, (c) => rpc(c, "create_receipt", { party_id: f.partyA, amount: 50, payment_mode: "cash" }, [{ invoice_id: inv, amount: 10 }]))).rejects.toThrow(/not an issued invoice of this party/);
    expect(await bal(f.partyB)).toBe(start + 120);                       // failed attempts left no trace

    await asUser(f.accountant, (c) => rpc(c, "create_receipt", { party_id: f.partyB, amount: 120, payment_mode: "cash" }, [{ invoice_id: inv, amount: 120 }]));
    b = (await pool.query("select payment_status, outstanding from invoice_balances where invoice_id=$1", [inv])).rows[0];
    expect([b.payment_status, Number(b.outstanding)]).toEqual(["paid", 0]);

    await expect(asUser(f.accountant, (c) => rpc(c, "cancel_invoice", inv, "wrong party"))).rejects.toThrow(/Cancel the receipts/);
    await asUser(f.accountant, (c) => rpc(c, "cancel_receipt", r1.id, "cheque bounced"));
    b = (await pool.query("select payment_status, outstanding from invoice_balances where invoice_id=$1", [inv])).rows[0];
    expect([b.payment_status, Number(b.outstanding)]).toEqual(["partial", 80]);
    await expect(asUser(f.accountant, (c) => rpc(c, "cancel_receipt", r1.id, "again please"))).rejects.toThrow(/already cancelled/);
  });
  it("cancelling an invoice with no active receipts reverses the ledger exactly", async () => {
    const start = await bal(f.partyA);
    const inv = await mkInvoice(f.partyA, [{ description: "Handling", quantity: 3, rate: 33.33, tax_percent: 18 }]);
    const issued = await asUser(f.accountant, (c) => rpc(c, "issue_invoice", inv));
    expect(await bal(f.partyA)).toBeCloseTo(start + Number(issued.total), 2);
    await asUser(f.accountant, (c) => rpc(c, "cancel_invoice", inv, "raised in error"));
    expect(await bal(f.partyA)).toBeCloseTo(start, 2);
    const draft = await mkInvoice();
    await asUser(f.accountant, (c) => rpc(c, "cancel_invoice", draft, "not needed"));       // drafts cancel without ledger entries
    expect(await bal(f.partyA)).toBeCloseTo(start, 2);
  });
  it("payments out hit the party ledger; non-party payments do not; cancel reverses", async () => {
    const start = await bal(f.partyA);
    const p = await asUser(f.accountant, (c) => rpc(c, "create_payment", { party_id: f.partyA, amount: 300, payment_mode: "bank_transfer", purpose: "Refund" }));
    expect(await bal(f.partyA)).toBe(start + 300);
    await asUser(f.accountant, (c) => rpc(c, "cancel_payment", p.id, "duplicate"));
    expect(await bal(f.partyA)).toBe(start);
    const before = (await pool.query("select count(*)::int n from party_ledger")).rows[0].n;
    await asUser(f.accountant, (c) => rpc(c, "create_payment", { payee_name: "Labour contractor", amount: 5000, payment_mode: "cash" }));
    expect((await pool.query("select count(*)::int n from party_ledger")).rows[0].n).toBe(before);
  });
  it("ledger_statement has opening row first, running balance and closes on the party balance", async () => {
    const rows = (await asUser(f.accountant, (c) => c.query("select * from ledger_statement($1, date '2000-01-01', current_date)", [f.partyA]))).rows;
    expect(rows[0].entry_type).toBe("opening");
    expect(Number(rows[0].balance)).toBe(1000);
    expect(Number(rows[rows.length - 1].balance)).toBeCloseTo(await bal(f.partyA), 2);
    const mid = rows.slice(1).reduce((s, r) => s + Number(r.debit) - Number(r.credit), 1000);
    expect(mid).toBeCloseTo(Number(rows[rows.length - 1].balance), 2);
  });
  it("customers see only own issued invoices, receipts, payments and ledger; staff see none", async () => {
    await asUser(f.custB, async (c) => {
      expect((await c.query("select distinct party_id from invoice_balances")).rows.map((r) => r.party_id)).toEqual([f.partyB]);
      expect((await c.query("select * from invoice_balances where status='draft'")).rowCount).toBe(0);
      expect((await c.query("select distinct party_id from receipts")).rows.map((r) => r.party_id)).toEqual([f.partyB]);
      expect((await c.query("select distinct party_id from party_ledger")).rows.map((r) => r.party_id)).toEqual([f.partyB]);
      expect(Number((await c.query("select balance from party_ledger_balances")).rows[0].balance)).toBe(await bal(f.partyB));
    });
    await asUser(f.staff, async (c) => {
      expect((await c.query("select * from invoices")).rowCount).toBe(0);
      expect((await c.query("select * from receipts")).rowCount).toBe(0);
    });
  });
  it("customers cannot call any billing function", async () => {
    for (const [fn, args] of [["create_receipt", [{ party_id: f.partyA, amount: 1, payment_mode: "cash" }, []]], ["create_payment", [{ party_id: f.partyA, amount: 1, payment_mode: "cash" }]], ["issue_invoice", [crypto.randomUUID()]]] as const) {
      await expect(asUser(f.custA, (c) => rpc(c, fn, ...args))).rejects.toThrow(/Permission denied/);
    }
  });
});

describe("reports", () => {
  it("stock_register reconciles: opening + inward - outward + adjustment = closing, and equals the ledger", async () => {
    const p = (await pool.query("insert into products (name) values ($1) returning id", [`Rep ${Date.now()}`])).rows[0].id;
    await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [{ product_id: p, rack_id: f.rackA1, bags: 50, kgs_per_bag: 10 }]));
    await asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA }, [{ product_id: p, rack_id: f.rackA1, bags: 20, kgs_per_bag: 10 }]));
    await asUser(f.admin, (c) => rpc(c, "post_stock_adjustment", f.partyA, p, f.rackA1, -2, -20, null, "spoilage written off"));
    const rows = (await asUser(f.admin, (c) => c.query("select * from stock_register(date '2000-01-01', current_date, $1, $2)", [f.partyA, p]))).rows;
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect([r.inward_bags, r.outward_bags, r.adjustment_bags, r.closing_bags].map(Number)).toEqual([50, 20, -2, 28]);
    expect(Number(r.opening_bags) + Number(r.inward_bags) - Number(r.outward_bags) + Number(r.adjustment_bags)).toBe(Number(r.closing_bags));
    const future = (await asUser(f.admin, (c) => c.query("select * from stock_register(current_date + 1, current_date + 30, $1, $2)", [f.partyA, p]))).rows[0];
    expect(Number(future.opening_bags)).toBe(28);                       // as-of-date opening
  });
  it("floor_report lists all 15 floors and its totals equal the ledger; customers get only their own totals", async () => {
    const rows = (await asUser(f.admin, (c) => c.query("select * from floor_report(date '2000-01-01', current_date)"))).rows;
    expect(rows).toHaveLength(15);
    const total = Number((await pool.query("select coalesce(sum(bags),0) b from stock_movements")).rows[0].b);
    expect(rows.reduce((s, r) => s + Number(r.current_bags), 0)).toBe(total);
    const mine = (await asUser(f.custA, (c) => c.query("select * from floor_report(date '2000-01-01', current_date)"))).rows;
    const myTotal = Number((await pool.query("select coalesce(sum(bags),0) b from stock_movements where party_id=$1", [f.partyA])).rows[0].b);
    expect(mine.reduce((s, r) => s + Number(r.current_bags), 0)).toBe(myTotal);
  });
  it("register views carry names, honour RLS, and rojmel lists today's documents", async () => {
    const [i, o] = [inward(f, { bags: 3 }), outward(f, { bags: 1 })];
    await asUser(f.admin, (c) => rpc(c, "create_inward", ...i));
    await asUser(f.admin, (c) => rpc(c, "create_outward", ...o));
    const a = (await asUser(f.custA, (c) => c.query("select distinct party_id from v_inward_lines"))).rows.map((r) => r.party_id);
    expect(a).toEqual([f.partyA]);
    const r = (await asUser(f.admin, (c) => c.query("select * from rojmel(current_date)"))).rows;
    expect(r.map((x) => x.kind)).toEqual(expect.arrayContaining(["Inward", "Outward"]));
    const lab = (await asUser(f.accountant, (c) => c.query("select * from v_labour"))).rowCount;
    expect(lab).toBeGreaterThan(0);
    expect((await asUser(f.staff, (c) => c.query("select * from v_labour"))).rowCount).toBe(0);     // labour.view not granted to staff
  });
});

describe("role permission admin", () => {
  it("only the owner can change permissions, and it takes effect immediately", async () => {
    await expect(asUser(f.manager, (c) => rpc(c, "set_role_permission", "staff", "stock.adjust", true))).rejects.toThrow(/Only the Owner/);
    await asUser(f.admin, (c) => rpc(c, "set_role_permission", "staff", "stock.adjust", true));
    await asUser(f.staff, (c) => rpc(c, "post_stock_adjustment", f.partyA, f.potato, f.rackA1, 1, 10, null, "count correction"));
    await asUser(f.admin, (c) => rpc(c, "set_role_permission", "staff", "stock.adjust", false));
    await expect(asUser(f.staff, (c) => rpc(c, "post_stock_adjustment", f.partyA, f.potato, f.rackA1, 1, 10, null, "count correction"))).rejects.toThrow(/Permission denied/);
    await expect(asUser(f.admin, (c) => rpc(c, "set_role_permission", "customer", "stock.adjust", true))).rejects.toThrow(/fixed/);
  });
});
