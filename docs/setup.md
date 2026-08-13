# Production setup

One-time runbook for standing up the database and wiring it to GitHub Actions and Vercel.

## 1. Create the Supabase project

Create a new project at [supabase.com](https://supabase.com). Note the database password.

## 2. Create the schema

In the Supabase dashboard, open SQL Editor, paste the contents of `supabase/schema.sql`, and run it. It is idempotent (safe to re-run). This creates the `items` and `offerings` tables with public-read RLS.

## 3. Get the Session pooler connection string

Dashboard, Connect, then choose **Session pooler** and copy the Postgres connection string (fill in the database password).

Use the Session pooler, not the direct connection: the direct connection is IPv6-only and GitHub Actions runners have no IPv6 route, so the scraper would fail to connect.

## 4. GitHub Actions secret

In the GitHub repo: Settings, Secrets and variables, Actions, New repository secret.

- Name: `SUPABASE_DB_URL`
- Value: the Session pooler connection string from step 3.

## 5. Vercel environment variables

In the Vercel project: Settings, Environment Variables. Add (values from Supabase dashboard, Settings, API):

- `SUPABASE_URL` — the project URL (`https://<project>.supabase.co`)
- `SUPABASE_ANON_KEY` — the anon public key

Redeploy so the serverless function picks them up.

## 6. Custom domain

The site is served from `umichfoodfinder.berezone.com`. In the Vercel project: Settings, Domains, add the subdomain, then add the CNAME record it shows at the `berezone.com` DNS provider. Once the domain is live, update the Supabase **Site URL** (see [auth-setup.md](auth-setup.md)) and the extension's ingest URL (see [browser-relay.md](browser-relay.md)) to match, or Google sign-in redirects and menu syncs keep pointing at the old `.vercel.app` host.

## 7. First scrape

In GitHub: Actions, select the **Scrape Menus** workflow, click **Run workflow**. It otherwise runs on a 6-hour schedule.

## 8. Verify

- Supabase Table Editor: `items` and `offerings` have rows.
- The live site loads menus (i.e. `/api/menus` returns data).
