"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    const syncTheme = () => {
      try {
        const saved = globalThis.localStorage?.getItem("tether-theme") ?? "system";
        const prefersDark =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches;
        const effectiveDark = saved === "dark" || (saved !== "light" && prefersDark);
        document.documentElement.setAttribute("data-theme", effectiveDark ? "dark" : "light");
      } catch {
        // ignore storage errors
      }
    };

    syncTheme();
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    media?.addEventListener("change", syncTheme);
    window.addEventListener("storage", syncTheme);
    return () => {
      media?.removeEventListener("change", syncTheme);
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator) ||
      // The Tauri shell serves the export from a custom protocol without SW support.
      "__TAURI_INTERNALS__" in window
    ) {
      return;
    }

    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
