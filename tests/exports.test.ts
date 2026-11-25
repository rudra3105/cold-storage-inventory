import { it, expect } from "vitest";
import { Pdf } from "@/lib/pdf";
import { toXlsx, toCsv } from "@/lib/xlsx";
it("renders pdf/xlsx/csv", async () => {
  const pdf = await Pdf.create({ landscape: true, footer: "t" });
  pdf.letterhead({ business_name: "Test Co" } as never, "Report");
  const rows = Array.from({ length: 120 }, (_, i) => ["x" + i, "₹ " + i, String(i)]);
  pdf.table([{ label: "A", weight: 2 }, { label: "B", weight: 1, align: "right" }, { label: "C", weight: 1, align: "right" }], rows, { boldLast: true });
  const bytes = await pdf.finish(); expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
  const cols = [{ label: "A", key: "a" }, { label: "N", key: "n", kind: "number" as const, align: "right" as const }];
  const x = await toXlsx([{ name: "S", title: "T", cols, rows: [{ a: "=cmd()", n: 5 }] }]); expect(x.length).toBeGreaterThan(1000);
  expect(toCsv(cols, [{ a: "=cmd()", n: 5 }])).toContain("'=cmd()");
});
