import { TetherApp } from "@/components/app/tether-app";
import { AppErrorBoundary } from "@/components/app/app-error-boundary";
import { LandingPage } from "@/components/marketing/landing-page";

export default function Home() {
  // Desktop Tauri builds open directly into the notes workspace.
  if (process.env.TAURI_BUILD === "1") {
    return (
      <AppErrorBoundary>
        <TetherApp />
      </AppErrorBoundary>
    );
  }

  return <LandingPage />;
}
