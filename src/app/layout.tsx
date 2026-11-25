import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";
import "./highlights.css";

export const metadata: Metadata = {
  title: {
    default: "Tether Notes",
    template: "%s | Tether Notes",
  },
  description: "A local-first notes workspace.",
  applicationName: "Tether Notes",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tether Notes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#d8e1e5",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // A nonce-based CSP is injected per request by src/proxy.ts, and Next can only
  // stamp the nonce on scripts during server rendering. Awaiting connection()
  // opts the web build into per-request rendering; the Tauri build is a static
  // export with no request, so it keeps prerendering and the static CSP from
  // tauri.conf.json.
  if (process.env.TAURI_BUILD !== "1") {
    await connection();
  }

  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
