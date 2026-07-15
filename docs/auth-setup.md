# Google sign-in setup (login + synced favorites)

The site works fully without login (favorites stay in the browser's
localStorage). Signing in with Google upgrades favorites to the account:
they sync across devices and merge whatever was already starred locally.

Auth is optional at build time: if the two `VITE_` env vars below are not
set, the sign-in button simply doesn't render.

## 1. Database table

Run `supabase/user_favorites.sql` in the Supabase SQL Editor (once).

## 2. Google OAuth credentials (~10 min, one time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create
   (or pick) a project.
2. **APIs & Services → OAuth consent screen**: External, fill in app name and
   your email; scopes `email` and `profile` are enough. Publish the app
   (leaving it in "Testing" limits sign-ins to listed test users).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (shown verbatim on the Supabase Google-provider page)
4. Copy the **Client ID** and **Client secret**.

## 3. Supabase configuration

1. **Authentication → Sign In / Providers → Google**: enable, paste the
   Client ID and Client secret, save.
2. **Authentication → URL Configuration**:
   - Site URL: `https://<your-site>.vercel.app`
   - Additional redirect URLs: `http://localhost:5173` (for local dev)

## 4. Vercel env vars (build-time, then redeploy)

- `VITE_SUPABASE_URL` — same value as `SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` — same value as `SUPABASE_ANON_KEY`

The `VITE_` prefix is required: it exposes the values to the client build.
The anon key is safe in the browser — Row Level Security restricts every
user to their own favorites, and menu tables are read-only to the public.

## Local development

Create `client/.env.local` (gitignored):

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

## How it behaves

- Signed out: favorites in localStorage, exactly the pre-auth behavior.
- First sign-in: local favorites are merged into the account (nothing lost).
- Signed in: favorites read/write the `user_favorites` table (and mirror to
  localStorage so the last state survives signing out).
- **My Menu** view: shows where and when your favorites appear in the next
  two weeks, soonest first — computed client-side from the loaded menu data.
