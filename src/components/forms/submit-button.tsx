"use client";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export function SubmitButton({ pending, children, ...p }: { pending: boolean } & ButtonProps) {
  return <Button type="submit" disabled={pending} {...p}>{pending && <Loader2 className="animate-spin" />}{children}</Button>;
}
