# Michigan Food Finder

[![Test](https://github.com/BereZone/MichiganFoodFinder/actions/workflows/test.yml/badge.svg)](https://github.com/BereZone/MichiganFoodFinder/actions/workflows/test.yml)

Michigan Food Finder shows University of Michigan dining hall menus in one place. A scheduled scraper pulls menus (with nutrition info and dietary tags) from dining.umich.edu into a Postgres database, and a React web app lets you browse and search what's being served across every hall.

**Live site:** https://TODO.vercel.app <!-- PLACEHOLDER: replace with the real Vercel URL -->

## Architecture

- `scrape_menus.py` — Python scraper, run every 6 hours by GitHub Actions, upserts into Supabase Postgres (`supabase/schema.sql`).
- `api/menus.js` — Vercel serverless function that queries Supabase with the anon key.
- `client/` — React + Vite + TypeScript + Tailwind frontend, reads from `/api/menus`.

## Documentation

- Quick start: [docs/development.md](docs/development.md)
- Production setup (Supabase, secrets, Vercel): [docs/setup.md](docs/setup.md)
- Release process: [docs/releasing.md](docs/releasing.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## License

MIT — see [LICENSE](LICENSE).
