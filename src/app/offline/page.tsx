import Link from "next/link";
import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="offline-frame">
      <section className="offline-sheet">
        <WifiOff aria-hidden="true" />
        <h1>You’re offline</h1>
        <p>
          Tether Notes can still open saved notes after the app shell has been cached.
          Reconnect once to finish loading this page.
        </p>
        <Link className="primary-button" href="/">Try again</Link>
      </section>
    </main>
  );
}
