# Tether Notes — design

**Assumption:** “right here” means a new `notes-pwa/` folder inside the non-empty workspace, avoiding unrelated projects and existing secret files.

## Objective

Build an installable, responsive notes PWA that works offline, syncs one user’s notes across devices through Supabase, and remains usable when Supabase is not configured.

## Approaches considered

### A. Local-first IndexedDB + Supabase sync — selected

- IndexedDB is the immediate source of truth for the UI.
- Every mutation is applied locally and placed in an idempotent outbox.
- Supabase receives queued changes when connectivity and a session are available.
- Supabase Realtime brings remote changes into the local cache.
- Best fit for a cross-device PWA because capture never waits on the network.

### B. Online-first Next.js server actions

- Smaller code surface, but offline editing and resilient background retries become awkward.
- Rejected because “all devices” should include intermittent connectivity.

### C. CRDT collaboration

- Strongest simultaneous-edit semantics, but adds document-operation storage, compaction, and migration complexity.
- Deferred until multi-user live collaboration is explicitly required.

## Product and experience

- Product name: **Tether Notes**; the identity is a linked-page mark and a cool blue-grey application frame.
- Primary question: “What was I working on, and can I capture the next thought immediately?”
- Primary job: create a note in one action and keep typing while sync happens in the background.
- Desktop: 228px labelled sidebar, 48px top bar, inset white work sheet, note list, and editor.
- Mobile: one pane at a time, compact top bar, bottom navigation, and installable PWA behavior.
- Visual reference: `framed-sheet`, seed `1111112303`, IBM Plex Sans, teal data/accent hue, no gradients or resting shadows.

## MVP behavior

1. Email/password sign-up, sign-in, sign-out, and session persistence through Supabase Auth.
2. Local-only mode when public Supabase environment variables are absent.
3. Create, edit, autosave, pin, archive, restore, soft-delete, search, and tag notes.
4. Immediate IndexedDB writes and durable queued mutations.
5. Online outbox flush, Realtime updates, visible offline/sync/error state, and manual retry.
6. Last-write-wins conflict policy using client `updated_at`; UUIDs make create/upsert retries idempotent.
7. PWA manifest, service worker, offline fallback, responsive shell, keyboard shortcuts, focus states, and reduced-motion support.

## Data model

`notes`

- `id uuid primary key`
- `user_id uuid not null references auth.users(id)`
- `title text not null default ''`
- `body text not null default ''`
- `tags text[] not null default '{}'`
- `is_pinned boolean not null default false`
- `is_archived boolean not null default false`
- `deleted_at timestamptz null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Indexes cover `(user_id, updated_at desc)`, pinned notes, and active-note lookup. Row-level security permits only `auth.uid() = user_id` for select/insert/update/delete. Realtime publication includes `notes`.

## Client architecture

- Next.js App Router and TypeScript.
- A client-side workspace owns authentication, selected note, filters, and sync lifecycle.
- Dexie stores `notes`, `outbox`, and small metadata records.
- A repository module isolates local CRUD, search normalization, and outbox creation.
- A sync module isolates Supabase pull, push, Realtime subscription, and retry behavior.
- Public Supabase keys are the only browser credentials; RLS is the authorization boundary.

## Error and state handling

- Local writes fail visibly without discarding editor text.
- Sync errors keep outbox records and expose Retry; exponential retries are bounded.
- Remote deletions become soft deletes locally.
- Empty, loading, local-only, offline, syncing, synced, and error states have explicit UI.
- Auth errors appear beside their fields; no secret values are logged.

## Verification

- Unit tests cover note creation, title fallback, filtering, tag normalization, ordering, and queued mutations.
- Static checks: ESLint and TypeScript.
- Production build must succeed without Supabase secrets.
- Manual acceptance: installability, mobile layout, offline create/edit, reconnect flush, and two-browser Realtime sync after configuring Supabase.
