import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";

export const metadata: Metadata = {
  title: { default: "Cold Storage Management", template: "%s · Cold Storage" },
  description: "Cold storage inward, outward, inventory and customer stock portal",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "ColdStore", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#0a5f73", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
