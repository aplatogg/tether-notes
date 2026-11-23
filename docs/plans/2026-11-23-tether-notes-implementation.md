# Tether Notes Implementation Plan

> **For Claude:** Execute sequentially in this session; this workspace is not a Git repository, so no commit steps are included.

**Goal:** Deliver a production-buildable Next.js + Supabase notes PWA with offline local storage and cross-device synchronization.

**Architecture:** The React workspace renders immediately from Dexie/IndexedDB and records mutations in an outbox. When Supabase configuration, connectivity, and an authenticated session are available, a sync engine pulls remote notes, flushes idempotent upserts/soft-deletes, and subscribes to Realtime changes. Supabase RLS is the authorization boundary.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Supabase JS, Dexie, Zod, Lucide, Vitest, Testing Library, manual service worker.

---

### Task 1: Scaffold and quality tooling

**Files:**
- Create via `create-next-app`: `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `src/app/*`, `public/*`
- Create: `vitest.config.ts`, `src/test/setup.ts`
- Modify: `package.json`

**Steps:**
1. Scaffold a TypeScript App Router project with Tailwind and ESLint into the existing `notes-pwa/` directory.
2. Install runtime packages: `@supabase/supabase-js`, `dexie`, `dexie-react-hooks`, `lucide-react`, `zod`, `clsx`.
3. Install test packages: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`.
4. Add `test`, `test:watch`, and `typecheck` scripts.
5. Verify `pnpm exec next --version` and `pnpm exec vitest --version` succeed.

### Task 2: Domain model and behavior tests

**Files:**
- Create: `src/lib/notes/types.ts`
- Create: `src/lib/notes/model.ts`
- Create: `src/lib/notes/model.test.ts`

**Steps:**
1. Write failing tests for new-note defaults, blank-title fallback, tag normalization, search, archive filtering, and pinned/updated ordering.
2. Run `pnpm test -- src/lib/notes/model.test.ts` and confirm failures.
3. Implement `createDraftNote`, `displayTitle`, `normalizeTags`, `matchesSearch`, `filterNotes`, and `sortNotes` as pure typed functions.
4. Re-run the targeted test and expect all cases to pass.

### Task 3: IndexedDB repository and durable outbox

**Files:**
- Create: `src/lib/db/database.ts`
- Create: `src/lib/db/repository.ts`
- Create: `src/lib/db/repository.test.ts`

**Steps:**
1. Define Dexie tables for notes, queued mutations, and metadata.
2. Test repository behavior against `fake-indexeddb`: local upsert, soft-delete, pending mutation coalescing, and remote writes that do not enqueue.
3. Implement transactional local writes and outbox coalescing by note ID.
4. Verify the repository test passes and no browser globals are accessed during server rendering.

### Task 4: Supabase schema, auth client, and sync engine

**Files:**
- Create: `supabase/migrations/202611230001_create_notes.sql`
- Create: `src/lib/supabase/config.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/sync/engine.ts`
- Create: `src/lib/sync/engine.test.ts`

**Steps:**
1. Add the `notes` table, constraints, indexes, trigger-maintained timestamps, RLS policies, and Realtime publication SQL.
2. Build a lazy browser client that returns `null` in local-only mode and never embeds service-role credentials.
3. Test outbox mapping, push success, retained failures, pull merge, and last-write-wins comparison with a mocked Supabase port.
4. Implement pull/push/subscription orchestration with bounded exponential retry and an observable sync state.
5. Verify all sync tests pass.

### Task 5: Application shell and notes workspace

**Files:**
- Replace: `src/app/page.tsx`, `src/app/globals.css`, `src/app/layout.tsx`
- Create: `src/components/app/tether-app.tsx`
- Create: `src/components/app/sidebar.tsx`
- Create: `src/components/app/topbar.tsx`
- Create: `src/components/notes/note-list.tsx`
- Create: `src/components/notes/note-editor.tsx`
- Create: `src/components/notes/empty-state.tsx`
- Create: `src/components/auth/auth-panel.tsx`
- Create: `src/components/settings/settings-panel.tsx`
- Create: `src/hooks/use-notes-workspace.ts`

**Steps:**
1. Establish framed-sheet design tokens, IBM Plex local font loading, focus styles, and responsive frame behavior.
2. Implement session-aware auth while preserving local-only mode.
3. Render notes from Dexie live queries; add search, filters, selection, create, autosave, tags, pin, archive, restore, and delete.
4. Add keyboard shortcuts: `Ctrl/Cmd+N`, `Ctrl/Cmd+K`, `Ctrl/Cmd+S`, and `Escape`.
5. Show explicit empty, loading, offline, local-only, syncing, synced, and sync-error states.
6. Add mobile list/editor navigation and accessible labels for every icon-only control.

### Task 6: PWA assets and offline navigation

**Files:**
- Create: `src/app/manifest.ts`
- Create: `src/app/offline/page.tsx`
- Create: `src/components/pwa/service-worker-registration.tsx`
- Create: `public/sw.js`
- Create: `public/icon.svg`, `public/icon-maskable.svg`
- Modify: `src/app/layout.tsx`, `next.config.ts`

**Steps:**
1. Define standalone display, theme colors, SVG icons, and app shortcuts.
2. Register a same-origin service worker only in production.
3. Cache the application shell and use network-first navigation with an offline fallback; never cache Supabase API responses.
4. Add security and PWA response headers in Next config.
5. Confirm the app builds with service worker assets present.

### Task 7: Documentation and release verification

**Files:**
- Create: `.env.example`
- Replace: `README.md`
- Create: `docs/supabase-setup.md`

**Steps:**
1. Document Supabase project creation, migration execution, Auth URL configuration, local-only mode, development, testing, and deployment.
2. Run `pnpm lint`; expect exit code 0.
3. Run `pnpm typecheck`; expect exit code 0.
4. Run `pnpm test --run`; expect all tests to pass.
5. Run `pnpm build`; expect a successful production build with no Supabase variables.
6. Run the design app linter and resolve every actionable finding.
