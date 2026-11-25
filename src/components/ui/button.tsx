import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[15px] font-semibold transition-[background-color,transform] active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[#084d5e]",
        secondary: "bg-primary-soft text-primary hover:bg-[#d3e8ed]",
        outline: "border border-input bg-card text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        destructive: "bg-destructive text-destructive-foreground hover:bg-[#8f1e18]",
        in: "bg-in text-white hover:bg-[#156a3a]",
        out: "bg-out text-white hover:bg-[#a54908]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: { default: "h-11 px-5", sm: "h-9 px-3.5 text-sm", lg: "h-14 px-7 text-base", icon: "size-11" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
export { buttonVariants };
