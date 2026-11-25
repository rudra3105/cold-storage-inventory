import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({ label, error, hint, className, children, htmlFor }: { label: string; error?: string; hint?: string; className?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-sm text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-destructive">{message}</p>;
}
export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p role="status" className="rounded-xl bg-in-soft px-4 py-3 text-base font-medium text-success">{message}</p>;
}
