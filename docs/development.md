# Development

## Prerequisites

- Node.js 20+
- Python 3.12+

## Setup

```bash
git clone https://github.com/BereZone/MichiganFoodFinder.git
cd MichiganFoodFinder
npm install                      # root deps (local API server)
cd client && npm install && cd ..
pip install -r requirements.txt  # scraper deps
```

## Running locally

The client talks to `/api/menus`, which reads from Supabase. Run the local API server and the Vite dev server in two terminals:

```bash
# Terminal 1 — API on http://localhost:3000
SUPABASE_URL=https://<project>.supabase.co SUPABASE_ANON_KEY=<anon-key> node local-server.js

# Terminal 2 — Vite dev server (proxies /api to :3000)
cd client && npm run dev
```

`SUPABASE_URL` is the Supabase project URL; `SUPABASE_ANON_KEY` is the anon public key (Supabase dashboard, Settings, API). See [setup.md](setup.md) for creating the project.

## Running the scraper locally

```bash
# Write to the database (Session pooler connection string — see setup.md)
SUPABASE_DB_URL=postgresql://... python3 scrape_menus.py

# No database: write menus.json at the repo root (gitignored)
python3 scrape_menus.py --json
```

## CI

The `Test` workflow (`.github/workflows/test.yml`) runs on every push and PR: Python unit tests, Node syntax checks, and the client typecheck + build. The `Scrape Menus` workflow (`update_menus.yml`) runs the scraper every 6 hours and can be triggered manually.

## Project layout

```
client/             React + Vite + TypeScript + Tailwind frontend
api/menus.js        Vercel serverless function (queries Supabase)
scrape_menus.py     Python scraper (dining.umich.edu -> Supabase)
supabase/schema.sql Database schema (items, offerings)
local-server.js     Local API server for development
.github/workflows/  CI, scheduled scraping, release automation
docs/               Project documentation
```
