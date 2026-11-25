import * as React from "react";
import { cn } from "@/lib/utils";

/** Roomy rows, sentence-case headings, scrolls sideways on phones. */
export const Table = ({ className, ...p }: React.ComponentProps<"table">) => (
  <div className="relative w-full overflow-x-auto">
    <table className={cn("w-full caption-bottom text-[15px]", className)} {...p} />
  </div>
);
export const TableHeader = (p: React.ComponentProps<"thead">) => <thead className="[&_tr]:border-b-2 [&_tr]:hover:bg-transparent" {...p} />;
export const TableBody = (p: React.ComponentProps<"tbody">) => <tbody className="[&_tr:last-child]:border-0" {...p} />;
export const TableRow = ({ className, ...p }: React.ComponentProps<"tr">) => (
  <tr className={cn("border-b transition-colors hover:bg-primary-soft/50", className)} {...p} />
);
export const TableHead = ({ className, ...p }: React.ComponentProps<"th">) => (
  <th className={cn("h-11 px-4 text-left align-middle text-sm font-bold text-muted-foreground whitespace-nowrap", className)} {...p} />
);
export const TableCell = ({ className, ...p }: React.ComponentProps<"td">) => (
  <td className={cn("px-4 py-3 align-middle whitespace-nowrap", className)} {...p} />
);
