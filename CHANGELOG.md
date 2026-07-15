# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Google sign-in with account-synced favorites (optional — the site is fully usable logged out, where favorites stay in localStorage and merge into the account on first login). See `docs/auth-setup.md`.
- "My Menu" view: shows where and when your favorited items appear over the next two weeks, soonest first.
- Browser-relay fallback for the Cloudflare-blocked dining site: Chrome extension (`extension/`) that parses menus in the user's own browser session and posts them to a new token-protected `/api/ingest` endpoint (see `docs/browser-relay.md`).
- Supabase Postgres database as the menu data store (`supabase/schema.sql`: `items` and `offerings` tables, full history retained, public-read RLS).
- Keep-alive step in the scrape workflow so GitHub does not pause the schedule on inactive repos.
- `--json` flag on `scrape_menus.py` for a no-database local run that writes `menus.json` at the repo root.

### Fixed

- Menu parsers updated for the redesigned dining.umich.edu markup (mid-2026): `span.item-name`, structured `ul.traits` tags, and nutrition tables as sibling `div.nutrition` elements. Python now parses with html5lib because the site's malformed lists are only recovered correctly by the browser parsing algorithm.

### Changed

- `/api/menus` now queries Supabase (anon key) instead of serving a committed static JSON file.
- Scraper rewritten to upsert menu data into Supabase with history retention, replacing the committed `client/public/menus.json`.
- GitHub Actions scrape workflow rewritten: writes to the database via the `SUPABASE_DB_URL` secret, no longer commits JSON to the repo.
- API dependencies switched from axios/cheerio (live-scraping) to `@supabase/supabase-js`.

### Removed

- Static `client/public/menus.json` from the repo (menu data lives in the database).
- Legacy duplicate scrapers: `api/scraping.py`, `api/_lib/scraper.js`, `scripts/`, and several stray root `.py` files.

## [1.0.0] - 2025-11-19

### Added

- Web app: React + Vite + TypeScript + Tailwind client showing University of Michigan dining hall menus.
- Vercel deployment with a serverless `/api/menus` endpoint.
- Python scraper for dining.umich.edu, run every 6 hours via GitHub Actions.

[Unreleased]: https://github.com/BereZone/MichiganFoodFinder/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/BereZone/MichiganFoodFinder/releases/tag/v1.0.0
