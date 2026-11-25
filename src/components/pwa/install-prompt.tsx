"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Env = "hidden" | "ios" | "standard";

function detectEnv(): Env {
  let dismissed = false;
  try { dismissed = localStorage.getItem("pwa-install-dismissed") === "1"; } catch { /* storage unavailable */ }
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (dismissed || standalone) return "hidden";
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "standard";
}
const subscribe = () => () => undefined;

/** Android/desktop Chrome: native install prompt. iOS Safari has no prompt API, so we show the Add-to-Home-Screen hint. */
export function InstallPrompt() {
  const env = useSyncExternalStore(subscribe, detectEnv, () => "hidden" as Env);   // server snapshot: hidden (no hydration mismatch)
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (closed || env === "hidden" || (!evt && env !== "ios")) return null;
  const close = () => { setClosed(true); try { localStorage.setItem("pwa-install-dismissed", "1"); } catch { /* ignore */ } };

  return (
    <div className="no-print fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-md items-center gap-3 rounded-lg border bg-card p-3 shadow-lg md:left-auto md:right-6">
      <Download className="size-5 shrink-0 text-primary" />
      <p className="flex-1 text-sm">{evt ? "Install this app for quick access." : "Install: tap Share, then “Add to Home Screen”."}</p>
      {evt && <Button size="sm" onClick={async () => { await evt.prompt(); await evt.userChoice; setEvt(null); close(); }}>Install</Button>}
      <Button size="icon" variant="ghost" className="size-8" onClick={close} aria-label="Dismiss"><X /></Button>
    </div>
  );
}
