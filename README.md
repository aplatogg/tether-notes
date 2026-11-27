<p align="center">
  <a href="https://tethernotes.me"><img alt="Live" src="https://img.shields.io/badge/🚀_live-tethernotes.me-0F766E"></a>
  <a href="https://github.com/aplatogg/tether-notes/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/aplatogg/tether-notes?color=0F766E&label=⬇️_download"></a>
  <a href="https://github.com/aplatogg/tether-notes/actions/workflows/keepalive.yml"><img alt="Keepalive" src="https://img.shields.io/github/actions/workflow/status/aplatogg/tether-notes/keepalive.yml?label=supabase%20keepalive"></a>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase&logoColor=white">
  <a href="https://github.com/aplatogg/tether-notes/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/aplatogg/tether-notes/ci.yml?branch=main&label=CI%20%28lint%20%C2%B7%20types%20%C2%B7%20tests%29"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/aplatogg/tether-notes?color=0F766E"></a>
</p>

<h1 align="center">📝 Tether Notes</h1>

<p align="center">
  <b>Local-first notes that follow you everywhere.</b><br>
  ⚡ Instant writes to IndexedDB · 🔌 Works fully offline · 🔄 Syncs across devices when you sign in · 🪟 Also ships as a Windows desktop app
</p>

<p align="center">
  👉 <a href="https://tethernotes.me"><b>Visit website</b></a> · 👉 <a href="https://tethernotes.me/app"><b>Open the live app</b></a> · 👉 <a href="https://github.com/aplatogg/tether-notes/releases/latest"><b>Grab the desktop build</b></a>
</p>

---

## ✨ Features

### 🗒️ Writing & organizing
- Create, edit, autosave, search, tag, pin, archive, restore, and soft-delete notes
- **Groups** (folders) with hierarchy — `Kerja/Q4` nests under `Kerja` — plus a calendar day-filter
- Reminders per note with local notifications 🔔
- Attachments: files + voice notes (Supabase Storage, 25 MB cap) 🎙️
- JSON export/import of everything 📦
- BYOK AI summary: bring your own endpoint + API key, stored **only in your browser** 🤖
- PIN-locked notes (hash stored with the note) + 30-day trash with restore / delete-forever 🔒

### 🤝 Sharing & teamwork (new in v0.3.1)
- **Team workspaces**: create a workspace, invite members by email, collaborate on notes in real time
- **Invitations inbox** with accept/decline — appears live, no reload needed
- Share a note with another account by email (read-only for them, grouped into **share groups** like `Kerja`, with auto-grouping per sender)
- Public read-only share links (`/s?t=…`) with 144-bit tokens

### ⚙️ Under the hood
- IndexedDB is the UI source of truth; local writes never wait for the network
- Durable, coalesced outbox with bounded retries and operation-ID protection for edits made while a request is in flight
- Pull/push sync with last-write-wins on `updated_at`, tombstones for deletes, and pruning of rows purged on other devices
- Email/password Supabase Auth, strict row-level security (grantee reads are masked for locked notes), and Realtime updates
- Local-only mode when public Supabase configuration is absent
- Responsive desktop list/editor + single-pane mobile navigation with a drawer
- Installable PWA with offline fallback; Android share-sheet capture via Web Share Target (`/mini`), iPhone via Shortcut
- Keyboard shortcuts: `Ctrl/Cmd+N`, `Ctrl/Cmd+K`, `Ctrl/Cmd+S`, `Escape`

### 🪟 Desktop (Tauri 2, Windows)
- Same Supabase project as web/PWA — one session, same notes everywhere
- `Ctrl+Alt+N` toggles a floating always-on-top mini capture window; `Ctrl+Enter` saves, `Esc` hides
- Download the installer from <a href="https://github.com/aplatogg/tether-notes/releases/latest">Releases</a> (`.exe` NSIS / `.msi` + SHA256 checksums)

---

## 🚀 Quick start

```powershell
pnpm install
Copy-Item .env.example .env.local   # optional: add Supabase vars for sync
pnpm dev
```

Open `http://localhost:3000/app` for the workspace (or `http://localhost:3000` for the landing page). With the env values blank, the app runs fully local (IndexedDB only) — perfect for trying it out.

## 🔐 Supabase mode (sync + accounts)

Follow [`docs/supabase-setup.md`](docs/supabase-setup.md), then set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

These are public browser credentials — never put a service-role key here or in any `NEXT_PUBLIC_*` variable. Authorization is enforced by the RLS policies in `supabase/migrations/`.

## 🧰 Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Next.js dev server |
| `pnpm lint` | ESLint, zero warnings allowed |
| `pnpm typecheck` | Route types + strict TypeScript |
| `pnpm test --run` | Run the Vitest suite once (203 tests) |
| `pnpm build` | Production build (Vercel) |
| `pnpm desktop:build` | Static export (`out/`) for the desktop shell |
| `pnpm tauri:dev` / `pnpm tauri:build` | Run / build the Windows desktop app |

## 🏗️ How it works

Dexie stores notes, the queued mutation outbox, and metadata; every edit commits note + outbox entry in one IndexedDB transaction. The sync engine pulls visible rows, merges newer remote records, prunes rows that vanished remotely, then pushes the outbox. A pending local mutation is never overwritten by a remote echo (operation-ID acknowledgements), and failed writes stay durable with a UI Retry.

The PWA service worker (production only) uses network-first for navigations with `/offline` fallback and cache-first for same-origin static assets; all Supabase/API/auth/realtime/storage traffic bypasses the SW. Security headers (CSP, frame-ancestors, HSTS, nosniff, referrer, permissions) are set in `next.config.ts`.

## 🚢 Deployment

Vercel project `plato-ba85/tether-notes` auto-deploys every push to `main` → **https://tethernotes.me**. Add the two public Supabase vars, allow the origin in Supabase Auth redirect URLs, serve over HTTPS.

## ⚠️ Honest limitations

- Not end-to-end encrypted — protected in transit (TLS) and at rest by RLS, but the server could read note content
- Sync runs while the app is open (no Background Sync yet)
- Last-write-wins per whole note; simultaneous edits to the same note don't merge at the character level
- Local-only notes aren't migrated into an account automatically
- CSP allows `connect-src https:` on purpose: the BYOK AI summary posts to whatever OpenAI-compatible endpoint the user configures, and a static CSP cannot vary per user. Routing the call through our server would close this, but it would break the promise on `/privacy` that the server never sees the key. Inline scripts are blocked with a per-request nonce, so this only matters if an XSS sink survives elsewhere.
- Trusted Types ships as `Content-Security-Policy-Report-Only`; once the console stays quiet it can be enforced.

## 📜 License

MIT — see [LICENSE](LICENSE).
