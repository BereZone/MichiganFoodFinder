# Contributing

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(optional scope): <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`.

Examples:

```
feat(client): add allergen filter to menu view
fix(scraper): capture stations with empty headings
```

Do NOT include AI co-author trailers (e.g. `Co-Authored-By: Claude ...`) in commits.

## Changelog

We follow [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Every user-facing change must add an entry to the `[Unreleased]` section of `CHANGELOG.md` (under `Added`, `Changed`, `Fixed`, or `Removed`).

## Versioning

Releases follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): breaking changes bump major, new features bump minor, fixes bump patch.

## Development setup

See [docs/development.md](docs/development.md).

## Releases

See [docs/releasing.md](docs/releasing.md).
