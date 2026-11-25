import * as React from "react";
import { cn } from "@/lib/utils";

/** Native select: best possible behaviour on mobile (OS picker), accessible by default. */
export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return <select className={cn("flex h-12 w-full rounded-[10px] border border-input bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/25 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20", className)} {...props}>{children}</select>;
}
