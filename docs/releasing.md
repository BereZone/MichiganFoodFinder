# Releasing

Releases are tagged from `main` and published as draft GitHub releases by the `Release` workflow.

## Process

1. **Update the changelog.** Move the `[Unreleased]` entries in `CHANGELOG.md` into a new `[X.Y.Z] - YYYY-MM-DD` section (today's date) and update the link references at the bottom.

2. **Bump the version:**

   ```bash
   make bump BUMP=patch   # or minor / major, or VERSION=x.y.z
   ```

   Confirms the target version interactively and updates `package.json` and `package-lock.json`. If the two files have drifted apart (e.g. a previous bump half-applied), it detects the drift instead of double-bumping on retry.

3. **Commit:**

   ```bash
   git commit -am "chore(release): vX.Y.Z"
   ```

4. **Tag:**

   ```bash
   make tag
   ```

   Creates an annotated tag `v<version>` from `package.json`. It validates semver, catches a doubled `v` (`vv1.0.0`), and refuses to tag if `CHANGELOG.md` has no section for that version.

5. **Push:**

   ```bash
   git push --follow-tags
   ```

6. **Release workflow.** On the `v*` tag push, the `Release` workflow validates the tag (fails on malformed semver or if `package.json`/`package-lock.json` versions don't match the tag), extracts that version's section from `CHANGELOG.md`, and creates a **draft** GitHub release. Source archives only; no extra assets.

7. **Publish.** Review the draft in the GitHub Releases UI and publish it manually.

## Undoing a bad tag

```bash
make untag VERSION=x.y.z
```

Confirms interactively, deletes the local and remote tag, and, if a GitHub release exists for it, asks whether to delete that too.

## Common failure modes

- **Tag / package.json mismatch** — the workflow fails if the tag version doesn't match `package.json` and `package-lock.json`. Run `make bump` (it detects drift), re-commit, `make untag`, then `make tag` again.
- **Missing changelog section** — `make tag` and the workflow both require a `[X.Y.Z]` section in `CHANGELOG.md`. Add it and retry.
- **Malformed tag (e.g. `vv1.0.0`)** — `make tag` catches a doubled `v`; if a bad tag was pushed by hand, remove it with `make untag` and re-tag.
