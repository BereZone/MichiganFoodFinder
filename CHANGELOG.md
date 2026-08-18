# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Plate** view: add menu items to a per-meal plate, adjust servings in 0.5 steps, and see summed calories, protein, carbs, fat, and sodium. Items missing nutrition data are flagged and the totals are labelled a lower bound. Plates are saved on the device and sync to your account when signed in (run `supabase/plates.sql` — see `docs/auth-setup.md`).
- Serving sizes are now captured from the menu (e.g. `1/2 Cup (113g)`) and shown on the Plate screen, scaled to the chosen number of servings, so you know how much to actually take. Requires re-running `supabase/schema.sql` for the new `offerings.serving_size` column, and a fresh menu sync to populate it.
- Browse rows adjust the plate in place: once an item is on the plate its add button becomes a `− servings +` stepper, and stepping below half a serving removes the item.

### Changed

- Redesigned the interface: a cool light-gray page with white panels, real borders and shadows, and Michigan navy carrying every primary action. Maize is now reserved for one job: active state, starred items, and today.
- **Stations are visually separated.** Each station inside a hall gets its own banded header with an item count and hard rules above and below it, so Grill, Deli and Bakery read as distinct blocks rather than one undifferentiated list.
- Set the site in Manrope, self-hosted and subset (25 KB latin, no external font requests). Previously the site had no typeface at all and fell back to whatever the OS shipped.
- Replaced every emoji used as an icon with a drawn SVG set on a single 24 grid and 1.5px stroke.
- Cut the row colour system down: meal is the one dimension that gets colour (four chips), dietary tags get the single semantic green, and nutrition marks are neutral.
- Moved the view tabs into the sticky app bar so they stay reachable while scrolling, and dropped the duplicated page title. My Menu and Plate get their own heading instead of repeating the hero.
- The hero headline changes with the Detroit clock, naming the meal that is on right now, or saying the kitchens are closed and tomorrow is already listed.
- Browse rows show every attribute the menu publishes (dietary tags, allergens, nutrient density, carbon footprint) instead of the first two, wrapping onto extra lines as needed. Item names are never truncated, and the calorie and control columns give up their fixed widths below 640px so the name gets the room.
- Fixed text and icon colours that fell below WCAG AA/AA-nontext, including the footer, the metadata under each item, and the resting (unstarred) star.
- The site now lives at https://umichfoodfinder.berezone.com. Docs, the extension's ingest-URL placeholder, and the Supabase sign-in redirect all point at the new domain; existing extension installs need their ingest URL updated in the popup.

### Removed

- Deleted the leftover Vite starter files (`App.css` with its spinning-logo keyframes, `react.svg`, `vite.svg`) and replaced the placeholder `<title>client</title>` with a real title, description, and theme-colour meta.

### Security

- `/api/menus` now refuses non-read methods (405) and redirects any query string back to the canonical URL (308). Both were free ways to bypass the CDN cache — Vercel never caches `POST`, and the cache key includes the query string — so each such request cost a full 14-day read out of Supabase.
- `/api/menus` memoizes its payload in the function instance for 5 minutes and shares one in-flight database read across concurrent requests, so a traffic burst costs one query rather than one per request.
- `/api/ingest` compares the ingest token in constant time and rejects payloads whose `Content-Length` exceeds 4 MB before parsing them.
- Dropped the meaningless `Access-Control-Allow-Credentials: true` from `/api/menus` (browsers reject it alongside `Origin: *`) and narrowed the advertised methods to `GET, HEAD, OPTIONS`.

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
