import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn("flex min-h-24 w-full rounded-[10px] border border-input bg-card px-3.5 py-3 text-base placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/25 aria-invalid:border-destructive", className)} {...props} />;
}
