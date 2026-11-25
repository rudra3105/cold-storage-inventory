import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div className={cn("rounded-2xl border bg-card text-card-foreground", className)} {...p} />
);
export const CardHeader = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div className={cn("flex flex-col gap-0.5 px-5 pt-5 pb-3", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.ComponentProps<"h3">) => (
  <h3 className={cn("text-lg font-bold tracking-tight", className)} {...p} />
);
export const CardDescription = ({ className, ...p }: React.ComponentProps<"p">) => (
  <p className={cn("text-[15px] text-muted-foreground", className)} {...p} />
);
export const CardContent = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div className={cn("px-5 pb-5", className)} {...p} />
);
