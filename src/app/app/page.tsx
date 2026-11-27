import type { Metadata } from "next";
import { TetherApp } from "@/components/app/tether-app";
import { AppErrorBoundary } from "@/components/app/app-error-boundary";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Open your local-first Tether Notes workspace.",
};

export default function AppWorkspacePage() {
  return (
    <AppErrorBoundary>
      <TetherApp />
    </AppErrorBoundary>
  );
}
