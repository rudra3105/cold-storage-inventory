import { beforeAll, describe, expect, it } from "vitest";
import { asUser, balance, buildFixture, pool, rpc, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => { f = await buildFixture(); });
const prod = async (n: string) => (await pool.query("insert into products (name) values ($1) returning id", [`${n} ${Date.now()}${Math.random()}`])).rows[0].id as string;
const line = (product: string, rack: string, bags: number, kpb = 10) => ({ product_id: product, rack_id: rack, bags, kgs_per_bag: kpb });

describe("modify inward", () => {
  it("changes quantity, keeps number, records reversal + new movement, audits the old version", async () => {
    const p = await prod("ModA");
    const inw = await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [line(p, f.rackA1, 100)]));
    const r = await asUser(f.admin, (c) => rpc(c, "update_inward", inw.id, { party_id: f.partyA, vehicle_no: "gj1ab1" }, [line(p, f.rackA1, 80)]));
    expect(r.inward_no).toBe(inw.inward_no);
    expect(await balance(f.partyA, p)).toEqual({ bags: 80, kgs: 800 });
    const mv = (await pool.query("select movement_type, bags from stock_movements where inward_id=$1 order by created_at, id", [inw.id])).rows;
    expect(mv.map((m) => m.movement_type).sort()).toEqual(["inward", "inward", "inward_reversal"]);
    expect((await pool.query("select count(*)::int n from inward_items where inward_id=$1", [inw.id])).rows[0].n).toBe(1);
    const a = (await pool.query("select meta from audit_logs where action='modify' and record_id=$1", [inw.id])).rows[0].meta;
    expect(a.before.items[0].bags).toBe(100);
    // cancelling afterwards reverses only the current version
    await asUser(f.admin, (c) => rpc(c, "cancel_inward", inw.id, "entered in error"));
    expect(await balance(f.partyA, p)).toEqual({ bags: 0, kgs: 0 });
  });
  it("cannot reduce below what has already been dispatched, can reduce to exactly that", async () => {
    const p = await prod("ModB");
    const inw = await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [line(p, f.rackA1, 100)]));
    await asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA }, [line(p, f.rackA1, 70)]));
    await expect(asUser(f.admin, (c) => rpc(c, "update_inward", inw.id, { party_id: f.partyA }, [line(p, f.rackA1, 60)]))).rejects.toThrow(/Insufficient stock/);
    expect(await balance(f.partyA, p)).toEqual({ bags: 30, kgs: 300 });          // untouched
    await asUser(f.admin, (c) => rpc(c, "update_inward", inw.id, { party_id: f.partyA }, [line(p, f.rackA1, 70)]));
    expect(await balance(f.partyA, p)).toEqual({ bags: 0, kgs: 0 });
    await asUser(f.admin, (c) => rpc(c, "update_inward", inw.id, { party_id: f.partyA }, [line(p, f.rackA1, 200)]));   // increasing is always fine
    expect((await balance(f.partyA, p)).bags).toBe(130);
  });
  it("moving an inward to another rack moves the stock", async () => {
    const p = await prod("ModC");
    const inw = await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [line(p, f.rackA1, 10)]));
    await asUser(f.admin, (c) => rpc(c, "update_inward", inw.id, { party_id: f.partyA }, [line(p, f.rackB3, 10)]));
    expect((await balance(f.partyA, p, f.rackA1)).bags).toBe(0);
    expect((await balance(f.partyA, p, f.rackB3)).bags).toBe(10);
  });
  it("permission-gated; cancelled documents cannot be modified; invalid edits roll back completely", async () => {
    const p = await prod("ModD");
    const inw = await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [line(p, f.rackA1, 10)]));
    await expect(asUser(f.staff, (c) => rpc(c, "update_inward", inw.id, { party_id: f.partyA }, [line(p, f.rackA1, 5)]))).rejects.toThrow(/Permission denied: inward.update/);
    await asUser(f.manager, (c) => rpc(c, "update_inward", inw.id, { party_id: f.partyA }, [line(p, f.rackA1, 12)]));
    await expect(asUser(f.manager, (c) => rpc(c, "update_inward", inw.id, { party_id: f.partyA }, [line(p, f.rackA1, 0)]))).rejects.toThrow(/bags must be/);
    expect((await balance(f.partyA, p)).bags).toBe(12);
    await asUser(f.admin, (c) => rpc(c, "cancel_inward", inw.id, "wrong entry"));
    await expect(asUser(f.admin, (c) => rpc(c, "update_inward", inw.id, { party_id: f.partyA }, [line(p, f.rackA1, 5)]))).rejects.toThrow(/cancelled/);
  });
});

describe("modify outward", () => {
  it("decrease returns stock; increase beyond availability is rejected and rolls back", async () => {
    const p = await prod("ModO");
    await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [line(p, f.rackA1, 100)]));
    const out = await asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA }, [line(p, f.rackA1, 40)]));
    await asUser(f.admin, (c) => rpc(c, "update_outward", out.id, {}, [line(p, f.rackA1, 25)]));
    expect((await balance(f.partyA, p)).bags).toBe(75);
    await asUser(f.admin, (c) => rpc(c, "update_outward", out.id, {}, [line(p, f.rackA1, 100)]));   // exactly everything
    expect((await balance(f.partyA, p)).bags).toBe(0);
    await expect(asUser(f.admin, (c) => rpc(c, "update_outward", out.id, {}, [line(p, f.rackA1, 101)]))).rejects.toThrow(/Insufficient stock/);
    expect((await balance(f.partyA, p)).bags).toBe(0);                                              // rolled back to previous valid state
    await asUser(f.admin, (c) => rpc(c, "cancel_outward", out.id, "returned"));
    expect((await balance(f.partyA, p)).bags).toBe(100);
  });
  it("concurrent modify + new outward cannot oversell", async () => {
    const p = await prod("ModRace");
    await asUser(f.admin, (c) => rpc(c, "create_inward", { party_id: f.partyA }, [line(p, f.rackA1, 10)]));
    const out = await asUser(f.admin, (c) => rpc(c, "create_outward", { party_id: f.partyA }, [line(p, f.rackA1, 5)]));
    let n = 0; let go!: () => void; const gate = new Promise<void>((r) => { go = r; });
    const bar = async () => { if (++n === 2) go(); await gate; };
    const res = await Promise.all([
      asUser(f.admin, async (c) => { await bar(); return rpc(c, "update_outward", out.id, {}, [line(p, f.rackA1, 10)]); }).then(() => "ok", (e) => String(e.message)),
      asUser(f.admin, async (c) => { await bar(); return rpc(c, "create_outward", { party_id: f.partyA }, [line(p, f.rackA1, 5)]); }).then(() => "ok", (e) => String(e.message)),
    ]);
    expect(res.filter((r) => r === "ok").length).toBe(1);
    expect((await balance(f.partyA, p)).bags).toBeGreaterThanOrEqual(0);
  });
});
