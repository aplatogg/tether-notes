import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";
// Tauri bundles a static export; Vercel keeps the normal Next.js build.
const isTauriBuild = process.env.TAURI_BUILD === "1";

// The Content-Security-Policy is set per request by src/proxy.ts so it can
// carry a nonce. Setting it here too would intersect the two policies and the
// old 'unsafe-inline' would survive the nonce.

const securityHeaders = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    // microphone=(self) is required for voice-note recording in the web build.
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  ...(!isDevelopment
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig: NextConfig = isTauriBuild
  ? {
      output: "export",
      trailingSlash: true,
      images: { unoptimized: true },
      // Security headers live in tauri.conf.json; static exports ignore headers().
    }
  : {
      async headers() {
        return [
          {
            source: "/(.*)",
            headers: securityHeaders,
          },
          {
            source: "/sw.js",
            headers: [
              { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
              { key: "Service-Worker-Allowed", value: "/" },
            ],
          },
        ];
      },
    };

export default nextConfig;
