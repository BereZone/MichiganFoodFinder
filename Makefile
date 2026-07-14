SHELL := /bin/bash
REMOTE := $(shell git remote | head -n1)
PKG_VERSION := $(shell node -p "require('./package.json').version")
LOCK_VERSION := $(shell node -p "require('./package-lock.json').version")

.PHONY: help check-versions bump tag untag

help:
	@echo "Targets:"
	@echo "  make bump BUMP=patch|minor|major   Bump the project version (or VERSION=x.y.z)"
	@echo "  make tag                           Create annotated tag v<version> from package.json"
	@echo "  make untag VERSION=x.y.z           Delete a tag locally and on the remote"
	@echo "  make check-versions                Verify package.json and package-lock.json agree"

check-versions:
	@if [ "$(PKG_VERSION)" != "$(LOCK_VERSION)" ]; then \
		echo "ERROR: package.json ($(PKG_VERSION)) and package-lock.json ($(LOCK_VERSION)) disagree."; \
		echo "       Run 'npm install --package-lock-only' to sync, or 'make bump' to resolve a retried bump."; \
		exit 1; \
	fi; \
	echo "Metadata OK: package.json and package-lock.json both at $(PKG_VERSION)."

bump:
	@set -euo pipefail; \
	CUR="$(PKG_VERSION)"; LOCK="$(LOCK_VERSION)"; \
	if [ -n "$(VERSION)" ]; then \
		NEW="$(VERSION)"; \
	elif [ -n "$(BUMP)" ]; then \
		IFS=. read -r MA MI PA <<< "$$CUR"; \
		case "$(BUMP)" in \
			major) NEW="$$((MA+1)).0.0" ;; \
			minor) NEW="$$MA.$$((MI+1)).0" ;; \
			patch) NEW="$$MA.$$MI.$$((PA+1))" ;; \
			*) echo "ERROR: BUMP must be major, minor, or patch."; exit 1 ;; \
		esac; \
	else \
		echo "Usage: make bump BUMP=patch|minor|major   (or make bump VERSION=x.y.z)"; exit 1; \
	fi; \
	if [[ ! "$$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$$ ]]; then \
		echo "ERROR: '$$NEW' is not plain MAJOR.MINOR.PATCH — no leading 'v'."; exit 1; \
	fi; \
	if [ "$$CUR" != "$$LOCK" ]; then \
		if [ "$$CUR" = "$$NEW" ] || [ "$$LOCK" = "$$NEW" ]; then \
			echo "Drift detected (package.json=$$CUR, package-lock.json=$$LOCK) — looks like a retried bump."; \
			read -p "Sync both files to $$NEW without bumping again? [y/N] " ans; \
			[[ "$$ans" == [yY]* ]] || { echo "Aborted."; exit 1; }; \
			npm pkg set version="$$NEW" >/dev/null; \
			npm install --package-lock-only >/dev/null; \
			echo "Synced package.json and package-lock.json to $$NEW."; exit 0; \
		fi; \
		echo "ERROR: package.json ($$CUR) and package-lock.json ($$LOCK) disagree and neither matches $$NEW."; \
		echo "       Resolve manually before bumping."; exit 1; \
	fi; \
	if [ "$$CUR" = "$$NEW" ]; then echo "Already at $$NEW — nothing to do."; exit 0; fi; \
	read -p "Bump version $$CUR -> $$NEW? [y/N] " ans; \
	[[ "$$ans" == [yY]* ]] || { echo "Aborted."; exit 1; }; \
	npm version "$$NEW" --no-git-tag-version >/dev/null; \
	echo "Bumped to $$NEW (package.json + package-lock.json)."; \
	echo "Next: update CHANGELOG.md, commit as 'chore(release): v$$NEW', then 'make tag'."

tag:
	@set -euo pipefail; \
	V="$(PKG_VERSION)"; \
	if [[ ! "$$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$$ ]]; then \
		echo "ERROR: package.json version '$$V' is not plain MAJOR.MINOR.PATCH (stray 'v'?)."; exit 1; \
	fi; \
	if [ "$$V" != "$(LOCK_VERSION)" ]; then \
		echo "ERROR: package-lock.json ($(LOCK_VERSION)) != package.json ($$V). Run 'npm install --package-lock-only'."; exit 1; \
	fi; \
	if git rev-parse -q --verify "refs/tags/v$$V" >/dev/null; then \
		echo "ERROR: tag v$$V already exists. Use 'make untag VERSION=$$V' first if it was a mistake."; exit 1; \
	fi; \
	if ! grep -q "^## \[$$V\]" CHANGELOG.md; then \
		echo "ERROR: CHANGELOG.md has no '## [$$V]' section — move the [Unreleased] entries first."; exit 1; \
	fi; \
	git tag -a "v$$V" -m "Release v$$V"; \
	echo "Created annotated tag v$$V."; \
	echo "Push it (with the release commit) using: git push --follow-tags"

untag:
	@set -euo pipefail; \
	V="$(VERSION)"; V="$${V#v}"; \
	if [ -z "$$V" ]; then echo "Usage: make untag VERSION=x.y.z"; exit 1; fi; \
	if [[ ! "$$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$$ ]]; then \
		echo "ERROR: '$(VERSION)' is not MAJOR.MINOR.PATCH."; exit 1; \
	fi; \
	read -p "Delete tag v$$V locally and on remote '$(REMOTE)'? [y/N] " ans; \
	[[ "$$ans" == [yY]* ]] || { echo "Aborted."; exit 1; }; \
	git tag -d "v$$V" 2>/dev/null || echo "(no local tag v$$V)"; \
	git push "$(REMOTE)" ":refs/tags/v$$V" 2>/dev/null || echo "(no remote tag v$$V)"; \
	if command -v gh >/dev/null 2>&1 && gh release view "v$$V" >/dev/null 2>&1; then \
		read -p "A GitHub release v$$V exists. Delete it too? [y/N] " ans2; \
		if [[ "$$ans2" == [yY]* ]]; then \
			gh release delete "v$$V" --yes; echo "Release v$$V deleted."; \
		else \
			echo "Left the release in place (the release workflow upserts on re-tag)."; \
		fi; \
	fi; \
	echo "Done."
