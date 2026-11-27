import Link from "next/link";

export const metadata = {
  title: "Privacy — Tether Notes",
  description: "How Tether Notes handles your data.",
};

export default function PrivacyPage() {
  return (
    <main className="auth-frame">
      <section className="auth-sheet privacy-sheet" aria-labelledby="privacy-title">
        <div className="brand-lockup auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>Tether Notes</span>
        </div>

        <h1 id="privacy-title">Privacy</h1>

        <p>
          Tether Notes is local-first: your notes live in your browser (IndexedDB) and only sync
          through your own Supabase account. We run no analytics, no ads, and no third-party
          trackers.
        </p>

        <h2>What we store</h2>
        <ul>
          <li>
            <strong>Account:</strong> email + password hash, managed by Supabase Auth. Passwords
            are never stored or visible in plain text.
          </li>
          <li>
            <strong>Notes:</strong> note content syncs to your Supabase project. Row-level
            security ensures only you (and accounts you explicitly share a note with) can read
            or edit them.
          </li>
          <li>
            <strong>Attachments &amp; voice notes:</strong> stored in a private Supabase Storage
            bucket, capped at 25 MB per file, and only accessible to you via short-lived signed
            URLs.
          </li>
          <li>
            <strong>AI summary key:</strong> if you use the AI summary feature, your API key is
            stored only in your browser&apos;s localStorage and sent only to the endpoint you
            configured. It never reaches our servers.
          </li>
        </ul>

        <h2>What we don&apos;t do</h2>
        <ul>
          <li>No tracking, fingerprinting, or advertising cookies.</li>
          <li>No selling or sharing of your data with third parties.</li>
          <li>No reading of your notes — the app is open source (github.com/aplatogg/tether-notes).</li>
        </ul>

        <h2>Your controls</h2>
        <ul>
          <li>Export all notes to JSON or delete your account at any time from the app.</li>
          <li>Remove the stored AI key from the AI panel (&quot;Remove key&quot;).</li>
          <li>Shared notes can be revoked by the owner at any time.</li>
        </ul>

        <p>
          Questions or takedown requests: open an issue on{" "}
          <a href="https://github.com/aplatogg/tether-notes">github.com/aplatogg/tether-notes</a>.
        </p>

        <p className="auth-foot">
          <Link href="/">← Back to Tether Notes</Link>
        </p>
      </section>
    </main>
  );
}
