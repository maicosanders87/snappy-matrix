# Snappy Matrix

Tech skills matrix, rookie cards, and team performance tracking for Snappy Services.

The site is a flat static build (`index.html` + `app.js` + assets). Every push to `main` is auto-deployed to GitHub Pages by `.github/workflows/deploy.yml`, which:

1. Bumps the patch version in `index.html` (e.g. `v218.5` → `v218.6`)
2. Injects a fresh `?v=<timestamp><version>` cache-bust onto every asset
3. Commits the bump back to `main` (tagged with the new version) using `[skip ci]` so it doesn't loop
4. Publishes the repo to GitHub Pages

The auto cache-buster in `<head>` of `index.html` then forces the browser to drop its old caches the next time anyone visits the page.

## Manual rollbacks

You have three rollback paths, from fastest to nuclear. **Pick the first one that fits your situation.**

### 1. Re-deploy a previous tag (preferred — no history rewrite)

Every successful CI run tags a release (e.g. `v218.5`, `v218.6`). To roll the live site back to one of those tags without touching `main`:

1. Go to **Actions → Deploy Snappy Matrix**
2. Click **Run workflow**
3. In the **"Tag or commit SHA to deploy"** input, type the tag (e.g. `v218.4`)
4. Run it

The workflow detects the pinned `ref`, **skips the version bump**, and re-publishes that exact code to Pages. The version badge will read whatever was in `index.html` at that tag.

### 2. Revert the bad commit on main

If a release introduced a bug and you want `main` itself to roll back (so the next normal push deploys cleanly on top of a known-good base):

```bash
git fetch origin
git checkout main
git pull --rebase
git revert <bad-commit-sha>          # creates a new revert commit
git push origin main
```

The push triggers a fresh CI run that bumps the version (e.g. `v218.6` → `v218.7`) and deploys the reverted state.

### 3. Reset main to a known-good SHA (destructive — last resort)

Only use this if the history itself needs to disappear (e.g. secrets were committed):

```bash
git fetch --tags origin
git checkout main
git reset --hard <good-sha-or-tag>   # e.g. v218.4
git push --force-with-lease origin main
```

This rewrites history. Anyone with a local clone will need to re-pull. CI runs automatically on the forced push.

## Version + cache-bust scheme

- Version badge top-left of the app reads e.g. `v218.6`
- Every script/style tag is loaded as `app.js?v=20260507093012v218.6` — the timestamp prefix guarantees a fresh URL even if two bumps happen on the same day
- On boot, `index.html` runs a tiny script that compares `localStorage['snappy_app_version']` against the embedded `APP_VERSION`. If they differ, it nukes Cache Storage, unregisters service workers, and hard-reloads — once per version per device

## Local development

```bash
# Serve the repo root with any static server, e.g.:
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step. Edit files, refresh, you're done. CI handles the version bump on push.
