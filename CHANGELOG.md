# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Plate** view: add menu items to a per-meal plate, adjust servings in 0.5 steps, and see summed calories, protein, carbs, fat, and sodium. Items missing nutrition data are flagged and the totals are labelled a lower bound. Plates are saved on the device and sync to your account when signed in (run `supabase/plates.sql` — see `docs/auth-setup.md`).
- Serving sizes are now captured from the menu (e.g. `1/2 Cup (113g)`) and shown on the Plate screen, scaled to the chosen number of servings, so you know how much to actually take. Requires re-running `supabase/schema.sql` for the new `offerings.serving_size` column, and a fresh menu sync to populate it.
- Browse rows adjust the plate in place: once an item is on the plate its add button becomes a `− servings +` stepper, and stepping below half a serving removes the item.

## [1.1.0] - 2026-07-28

### Added

- Version tag in the site footer, linking to this changelog. The version comes from the root `package.json` at build time.
- Google sign-in with account-synced favorites (optional — the site is fully usable logged out, where favorites stay in localStorage and merge into the account on first login). See `docs/auth-setup.md`.
- "My Menu" view: shows where and when your favorited items appear over the next two weeks, soonest first.
- Browser-relay fallback for the Cloudflare-blocked dining site: Chrome extension (`extension/`) that parses menus in the user's own browser session and posts them to a new token-protected `/api/ingest` endpoint (see `docs/browser-relay.md`).
- Supabase Postgres database as the menu data store (`supabase/schema.sql`: `items` and `offerings` tables, full history retained, public-read RLS).
- Keep-alive step in the scrape workflow so GitHub does not pause the schedule on inactive repos.
- `--json` flag on `scrape_menus.py` for a no-database local run that writes `menus.json` at the repo root.

### Fixed

- Station section headers no longer repeat spuriously when a station crosses a page boundary.
- Brunch now has its own meal badge colour instead of falling through to the Dinner styling.
- "Open now" resolves the current date, weekday, and meal in `America/Detroit`, so users outside Eastern time get the right meal.
- Menu parsers updated for the redesigned dining.umich.edu markup (mid-2026): `span.item-name`, structured `ul.traits` tags, and nutrition tables as sibling `div.nutrition` elements. Python now parses with html5lib because the site's malformed lists are only recovered correctly by the browser parsing algorithm.

### Changed

- Redesigned UI with UMich maize-and-blue branding: sticky glass header, skeleton loading, collapsible tag filter, formatted date labels, result count, and a "Clear all" button. Dark mode uses a deep-navy palette.
- Results are grouped by date → meal × hall, with station subsections inside each group. Pagination steps by date so a station is never split across pages.
- App renamed to Michigan Food Finder.
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

[Unreleased]: https://github.com/BereZone/MichiganFoodFinder/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/BereZone/MichiganFoodFinder/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/BereZone/MichiganFoodFinder/releases/tag/v1.0.0
