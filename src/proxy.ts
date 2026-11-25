import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request CSP with a nonce. Inline scripts are the highest-value XSS target
 * (localStorage holds the AI key and the note cache), so script-src uses a
 * fresh nonce plus 'strict-dynamic' on every document. Next.js picks the nonce
 * up from the request CSP header and stamps its own script tags with it.
 *
 * The desktop build is a static export (Tauri) and cannot run request-time proxy code; its
 * CSP stays static in src-tauri/tauri.conf.json. The web deployment is the
 * only place user-supplied HTML can reach a browser from another party.
 */
const isDevelopment = process.env.NODE_ENV === "development";

function createNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function proxy(request: NextRequest) {
  const nonce = createNonce();

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // CSP3 browsers ignore 'self' here and trust scripts loaded by trusted code,
    // which is what Next's chunk loader needs. Older browsers fall back to 'self'.
    "'strict-dynamic'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ].join(" ");

  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Inline styles remain: Next and the editor emit style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // BYOK AI summary posts to the user's own OpenAI-compatible endpoint, so any
    // https origin must be allowed. Documented as a tradeoff in README.
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  // Trusted Types is rolled out report-only: Firefox/Safari versions without
  // support still get the nonce protection above.
  const reportOnlyPolicy = [
    "require-trusted-types-for 'script'",
    "trusted-types dompurify",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("Content-Security-Policy-Report-Only", reportOnlyPolicy);
  return response;
}

export const config = {
  // Static assets and the service worker carry no user HTML; skipping them
  // avoids pinning a nonce onto cached build files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|workbox).*)"],
};