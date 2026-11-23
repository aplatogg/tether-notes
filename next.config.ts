import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";
// Tauri bundles a static export; Vercel keeps the normal Next.js build.
const isTauriBuild = process.env.TAURI_BUILD === "1";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
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
