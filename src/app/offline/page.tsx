import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <WifiOff className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">You are offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Stock and transactions need a live connection to stay accurate. Nothing you entered has been saved.
        Reconnect and reload to continue.
      </p>
    </main>
  );
}
