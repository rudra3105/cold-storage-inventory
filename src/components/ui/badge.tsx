import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none before:size-1.5 before:rounded-full before:bg-current", {
  variants: {
    variant: {
      default: "bg-secondary text-secondary-foreground",
      success: "bg-in-soft text-success",
      warning: "bg-out-soft text-warning",
      destructive: "bg-red-50 text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});
export function Badge({ className, variant, ...p }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...p} />;
}
