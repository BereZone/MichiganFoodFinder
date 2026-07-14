# Agent notes

## Conventions

- Conventional Commits, Keep a Changelog 1.1.0, Semantic Versioning 2.0.0.
- Update `CHANGELOG.md` `[Unreleased]` for every user-facing change.
- Never add `Co-Authored-By: Claude` or other AI co-author trailers to commits.
- Documentation lives in `docs/`. Keep `README.md` lean — link to `docs/` instead of expanding it.

## Codebase map

- `client/` — React + Vite + TypeScript + Tailwind frontend.
- `api/menus.js` — Vercel serverless function; reads menus from Supabase (anon key).
- `scrape_menus.py` — Python scraper for dining.umich.edu; upserts into Supabase.
- `supabase/schema.sql` — database schema (`items`, `offerings`; public-read RLS).
- `.github/workflows/` — `test.yml` (CI), `update_menus.yml` (scrape every 6h), `release.yml` (draft release on `v*` tags).
- `local-server.js` — local API server for development (see `docs/development.md`).
