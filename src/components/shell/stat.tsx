import { cn } from "@/lib/utils";

/** A single figure: quiet label, big number. No box; a left rule groups it. */
export function Stat({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("border-l-4 border-primary/25 pl-3 sm:pl-4", className)}>
      <p className="text-[15px] leading-snug text-muted-foreground">{label}</p>
      <p className="mt-1 text-[26px] font-bold sm:text-[32px] leading-none tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}
