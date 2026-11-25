import Link from "next/link";
import { Button } from "@/components/ui/button";

/** GET form: filters live in the URL, so lists are shareable, printable and work without JS. */
export function FilterBar({ children, resetHref }: { children: React.ReactNode; resetHref: string }) {
  return (
    <form method="get" className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
      {children}
      <div className="flex gap-2">
        <Button type="submit">Show</Button>
        <Button asChild type="button" variant="ghost"><Link href={resetHref}>Clear</Link></Button>
      </div>
    </form>
  );
}

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-sm font-semibold sm:flex-none">{label}{children}</label>;
}

export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    q.set("page", String(p));
    return `${basePath}?${q}`;
  };
  return (
    <div className="no-print mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>{total.toLocaleString("en-IN")} record{total === 1 ? "" : "s"} · page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Button asChild size="sm" variant="outline"><Link href={href(page - 1)}>Previous</Link></Button>}
        {page < pages && <Button asChild size="sm" variant="outline"><Link href={href(page + 1)}>Next</Link></Button>}
      </div>
    </div>
  );
}
