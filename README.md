<p align="center">
  <a href="https://tethernotes.me"><img alt="Live" src="https://img.shields.io/badge/live-tethernotes.me-0F766E"></a>
  <a href="https://github.com/aplatogg/tether-notes/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/aplatogg/tether-notes?color=0F766E"></a>
  <a href="https://github.com/aplatogg/tether-notes/actions/workflows/keepalive.yml"><img alt="Keepalive" src="https://img.shields.io/github/actions/workflow/status/aplatogg/tether-notes/keepalive.yml?label=supabase%20keepalive"></a>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase&logoColor=white">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/aplatogg/tether-notes?color=0F766E"></a>
</p>

# Tether Notes

Tether Notes is an installable local-first notes app. Notes are written to IndexedDB immediately, remain available offline, and can sync across authenticated devices through Supabase.

## Features

- Create, edit, autosave, search, tag, pin, archive, restore, and soft-delete notes.
- Share a note with another account by email (read-only for them, listed under "Shared with me") or via a public read-only link.
- PIN-locked notes (hash stored with the note) and a 30-day trash with restore/delete-forever.
- Reminders per note with local notifications, folders, a calendar day-filter, attachments (files + voice notes via Supabase Storage), JSON export/import, and a BYOK AI summary (your own API key, stored only in this browser).
- IndexedDB is the UI source of truth; local writes never wait for the network.
- Durable, coalesced outbox with bounded retries and operation-ID protection for edits made while a request is in flight.
- Email/password Supabase Auth, strict row-level security, pull/push sync, and Realtime updates.
- Local-only mode when public Supabase configuration is absent.
- Responsive desktop list/editor and single-pane mobile navigation.
- Installable PWA shell with an offline navigation fallback.
- Mobile: add to Home Screen (Android Chrome "Install app", iPhone Safari Share → "Add to Home Screen"). Android can share text straight into the app via the system share sheet (Web Share Target → `/mini`). iPhone: build a Shortcut that opens `https://tethernotes.me/mini?text=<input>&save=1`.
- Keyboard shortcuts: `Ctrl/Cmd+N`, `Ctrl/Cmd+K`, `Ctrl/Cmd+S`, and `Escape`.

## Requirements

- Node.js `^24.15.0` or `>=26.0.0`
- pnpm `12.6.0`

## Run locally

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`. With the two environment values left blank, the app displays a local workspace immediately and persists notes only in that browser's IndexedDB.

## Supabase mode

Follow [`docs/supabase-setup.md`](docs/supabase-setup.md), then set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

These are public browser credentials. Never put a service-role key in this app or in any `NEXT_PUBLIC_*` variable. Authorization is enforced by the migration's RLS policies.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Next.js development server |
| `pnpm lint` | Run ESLint with zero warnings allowed |
| `pnpm typecheck` | Generate route types and run strict TypeScript checks |
| `pnpm test --run` | Run the Vitest suite once |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm build` | Create a production build |
| `pnpm start` | Serve the production build |
| `pnpm desktop:build` | Static export (`out/`) used by the desktop shell |
| `pnpm tauri:dev` | Run the Tauri desktop app against the Next dev server |
| `pnpm tauri:build` | Build the Windows desktop installers |

## Data and sync model

Dexie stores three local collections: notes, queued mutations, and metadata. Every edit and its outbox mutation are committed in one IndexedDB transaction. Repeated edits to one note replace its queued snapshot while preserving queue age. Soft-deletes remain as tombstones so deletion can sync.

The sync engine pulls the user's rows, merges newer remote records, then pushes queued upserts and soft-deletes. Last-write-wins uses `updated_at`. A pending local mutation is never overwritten by a remote echo, and completion of an older request cannot clear a newer mutation because acknowledgements must match the queued operation ID. Failed writes remain durable and are retried a bounded number of times; the UI exposes Retry.

## PWA behavior

The service worker registers only in production. Navigations use network-first behavior with `/offline` as the fallback. Same-origin static assets use cache-first behavior. Supabase, API, authentication, Realtime, storage, and function requests are explicitly excluded from service-worker caching.

To test the installed/offline behavior locally:

```powershell
pnpm build
pnpm start
```

Open the app once while online before testing offline navigation.

## Desktop app (Tauri)

`src-tauri/` wraps the same app in a native Windows shell using Tauri 2 and the system WebView2. It talks to the same Supabase project, so a desktop session and a browser session see the same notes.

- `pnpm tauri:dev` starts `next dev` and opens the desktop window against it.
- `pnpm tauri:build` runs `pnpm desktop:build` (a static export in `out/`) and produces installers under `src-tauri/target/release/bundle/`.
- `pnpm build` stays a normal Next.js server build, so Vercel deployment is unaffected. The static export only happens when `TAURI_BUILD=1`, set by `scripts/desktop-build.mjs`.

Prerequisites: Rust (MSVC toolchain), Visual Studio Build Tools with the C++ workload, Windows SDK, and WebView2 runtime (preinstalled on Windows 10/11).

The service worker is skipped inside the Tauri shell because its custom protocol does not support it; the static assets are already local.

## Deployment

Deploy as a standard Next.js application, for example on Vercel:

1. Add the two public Supabase variables to the deployment environment, or omit both for local-only mode.
2. Add the production origin to Supabase Auth Site URL and Redirect URLs.
3. Run `pnpm build` in CI.
4. Serve over HTTPS so service workers and installability are available.

The project sets CSP, frame, content-type, referrer, permissions, HSTS, and service-worker scope headers in `next.config.ts`.

## Current limitations

- Local-only notes are intentionally isolated under the local owner and are not automatically migrated into an account later.
- Sync runs while the app is open; Background Sync is not used.
- Notes are plain text with tags; attachments, rich text, sharing, and collaborative editing are outside this MVP.
- Data is protected in transit and by Supabase RLS, but note content is not end-to-end encrypted.
- Last-write-wins resolves whole-note conflicts rather than merging simultaneous edits within the body.

## Deploy status
- Vercel project `plato-ba85/tether-notes` is connected to this GitHub repository; every push to `main` creates a production deployment.
- Live URL: https://tethernotes.me (www redirects to the apex with 308)


## Quick capture (desktop only)

Press **Ctrl+Alt+N** anywhere on Windows to toggle a floating mini-window:

- always on top, no taskbar entry, no title bar (drag via the header)
- first line becomes the note title, the rest is the body
- **Ctrl+Enter** saves and hides the window, **Esc** hides it
- `Open workspace` brings the main window forward
- recent notes are one click away to continue writing

The desktop shell keeps its own session, so sign in once inside the app to sync captures to the same Supabase project as the web/PWA build.


