import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { BrandMark } from "@/components/shell/brand-mark";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

/** The side panel is the building itself: 3 rooms x 5 floors, the same map staff see on Home. */
function BuildingArt() {
  const fill = [[0.9, 0.55, 0.3, 0.7, 0.2], [0.4, 0.85, 0.6, 0.25, 0.5], [0.65, 0.3, 0.8, 0.45, 0.15]];
  return (
    <div className="grid grid-cols-3 gap-2.5" aria-hidden>
      {fill.map((col, c) => (
        <div key={c} className="grid gap-2.5">
          {col.map((v, r) => <div key={r} className="h-12 rounded-lg" style={{ backgroundColor: `rgb(255 255 255 / ${0.1 + v * 0.45})` }} />)}
        </div>
      ))}
    </div>
  );
}

export default async function LoginPage() {
  const ctx = await getAuthContext();
  if (ctx) redirect(ctx.role === "customer" ? "/portal" : "/admin");
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="hidden flex-col justify-between bg-primary p-12 text-white lg:flex">
        <div className="flex items-center gap-3"><BrandMark className="size-11" /><span className="text-xl font-bold">Cold Storage</span></div>
        <div className="max-w-sm space-y-8">
          <BuildingArt />
          <p className="text-3xl font-bold leading-tight">Know what is in every room, on every floor.</p>
        </div>
        <p className="text-base text-white/75">Goods in, goods out, stock and bills in one place.</p>
      </section>
      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><BrandMark className="size-11" /><span className="text-xl font-bold">Cold Storage</span></div>
          <h1 className="text-[32px] font-bold leading-tight tracking-tight">Sign in</h1>
          <p className="mt-1 mb-7 text-base text-muted-foreground">Use the email and password the office gave you.</p>
          <LoginForm />
          <p className="mt-7 text-base text-muted-foreground">Forgot your password? Ask the office to set a new one.</p>
        </div>
      </section>
    </main>
  );
}
