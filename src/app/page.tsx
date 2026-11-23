import { TetherApp } from "@/components/app/tether-app";
import { AppErrorBoundary } from "@/components/app/app-error-boundary";

export default function Home() {
  return (
    <AppErrorBoundary>
      <TetherApp />
    </AppErrorBoundary>
  );
}
