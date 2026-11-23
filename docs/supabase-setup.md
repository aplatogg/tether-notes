# Supabase setup

Tether Notes runs without Supabase, but account sign-in and cross-device sync require one Supabase project.

## 1. Create the project

Create a Supabase project and wait for its database to become available. Record only these browser-safe values from **Project Settings > API**:

- Project URL
- Public anonymous key

Do not use or expose the service-role key.

## 2. Apply the migration

The migration is [`supabase/migrations/202611230001_create_notes.sql`](../supabase/migrations/202611230001_create_notes.sql). It creates the notes table, indexes, monotonic update trigger, RLS policies, replica identity, and guarded Realtime publication registration.

With the Supabase CLI:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Alternatively, open the Supabase SQL Editor, paste the migration, and run it once. The migration guards object creation and Realtime registration so repeating it does not duplicate publication membership.

## 3. Configure email authentication

In **Authentication > Providers > Email**:

1. Enable the Email provider.
2. Choose whether email confirmation is required. When enabled, the app asks the user to confirm before signing in.
3. Set **Authentication > URL Configuration > Site URL** to `http://localhost:3000` during local development or to the production HTTPS origin after deployment.
4. Add `http://localhost:3000/**` and the production origin pattern to **Redirect URLs**.

Tether Notes uses email/password methods only. No server-side auth secret is required.

## 4. Configure the browser app

Copy the example file:

```powershell
Copy-Item .env.example .env.local
```

Fill in both values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Restart `pnpm dev` after changing environment values. If either value is missing, Tether Notes deliberately starts in local-only mode and does not create a Supabase client.

## 5. Verify

1. Start the app with `pnpm dev`.
2. Create an account and complete email confirmation if enabled.
3. Create and edit a note; the top bar should move from Syncing to Synced.
4. Open a second browser profile, sign in to the same account, and confirm the note appears.
5. Put one browser offline, edit the note, reconnect, and use Retry only if the automatic bounded retry ends in an error.

The `notes` table should contain only rows owned by the signed-in user. RLS checks `auth.uid() = user_id` on select, insert, update, and delete.

## Production deployment

Set both public variables in the hosting provider, apply the migration to the production Supabase project, and add the final HTTPS origin to Auth Site URL and Redirect URLs. Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
```

Serve over HTTPS. The production build registers `/sw.js`; development intentionally does not register a service worker.

## Conflict and retention behavior

- Remote and local rows use whole-note last-write-wins by `updated_at`.
- A queued local edit wins over remote echoes until that operation is acknowledged.
- A stale acknowledgement cannot remove a newer queue entry because every queued snapshot has a unique operation ID.
- Delete is a soft-delete timestamp, not a hard database delete.
- Cached records are isolated by user ID. Signing out leaves that user's encrypted-transport, RLS-protected server data and local browser cache intact for later sign-in; another user ID cannot list it through the repository.
