# Browser relay (menu sync via your own browser)

dining.umich.edu serves a Cloudflare challenge to every non-browser client
(since ~March 2026), so server-side scraping — GitHub Actions included — gets
blocked. The browser relay works around this legitimately: a small Chrome
extension fetches and parses the menu pages **inside your own browser session**
(where Cloudflare already trusts you) and posts the parsed rows to the
token-protected `/api/ingest` endpoint, which upserts them into Supabase.

While Chrome is running, the extension syncs automatically every 6 hours; you
can also click **Sync now** in its popup. Menus are published ~2 weeks ahead,
so even a couple of syncs per week keeps the site fresh.

## One-time setup

### 1. Vercel environment variables

In addition to `SUPABASE_URL` and `SUPABASE_ANON_KEY` (see [setup.md](setup.md)),
add two more in Vercel → Settings → Environment Variables, then redeploy:

- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API Keys →
  `service_role`. This key bypasses RLS; it lives **only** in Vercel env vars.
- `INGEST_TOKEN` — a long random secret you generate yourself:

  ```sh
  openssl rand -hex 32
  ```

### 2. Install the extension

1. Open `chrome://extensions`, enable **Developer mode** (top right).
2. Click **Load unpacked** and select the `extension/` folder of this repo.
3. Click the extension's icon (pin it for convenience) and fill in:
   - **Ingest URL**: `https://umichfoodfinder.berezone.com/api/ingest`
   - **Ingest token**: the same value you set as `INGEST_TOKEN`.
4. Click **Sync now**. The popup shows progress per day and a green summary
   like `Synced 6800 rows across 15 day(s)` when finished.

## How it behaves

- **Badge**: `…` while syncing, `✓` on success, `!` on failure (open the popup
  for details).
- **Cloudflare challenge**: if a sync starts before the site trusts your
  browser, the extension opens dining.umich.edu in a background tab for ~25s
  to let the challenge clear, then retries once. If it still fails, visit
  dining.umich.edu in a normal tab and click **Sync now** again.
- **Safety**: the ingest endpoint refuses empty payloads (a broken parse can
  never wipe the database), validates every row, and only removes future-dated
  items that genuinely dropped off a menu that was successfully parsed.
  Historical rows are never touched.

## Limitations

- Syncs only happen while Chrome is running on your machine.
- If UMich grants access to the official Dining API
  (`gw.api.it.umich.edu/um/Dining`), the GitHub Actions scraper replaces this
  relay entirely — re-enable the cron in `.github/workflows/update_menus.yml`.
