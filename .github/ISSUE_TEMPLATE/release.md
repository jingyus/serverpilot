---
name: Release Checklist
about: Checklist for publishing a new ServerPilot release
title: 'Release v[VERSION]'
labels: release
assignees: ''
---

## Release Checklist for v[VERSION]

### Pre-release

- [ ] All CI checks pass on `master` (lint, typecheck, test, build)
- [ ] CHANGELOG.md updated with release notes under `## [VERSION] - YYYY-MM-DD`
- [ ] No open P0/P1 bugs blocking release
- [ ] E2E tests pass (`pnpm test:e2e`)

### License Verification

- [ ] `packages/agent/package.json` license is `Apache-2.0`
- [ ] `packages/server/package.json` license is `AGPL-3.0`
- [ ] `packages/dashboard/package.json` license is `AGPL-3.0`
- [ ] `packages/shared/package.json` license is `MIT`
- [ ] LICENSE files present in each package directory

### Version Bump

- [ ] Run `pnpm release v[VERSION] --dry-run` to preview changes
- [ ] Verify version will be updated in all 5 `package.json` files

### Release Execution

- [ ] Run `pnpm release v[VERSION]` (or with `--skip-gh-release` to create tag only)
- [ ] Push tag: `git push origin v[VERSION]`
- [ ] Verify GitHub Actions `Release` workflow runs successfully
- [ ] Verify Agent binaries are attached (4 platforms: linux-x64, linux-arm64, darwin-arm64, darwin-x64)
- [ ] Verify Docker images are published to GHCR and Docker Hub

### Post-release Verification

- [ ] Download and test Agent binary on at least 1 platform
- [ ] Pull and verify Docker images:
  ```bash
  docker pull ghcr.io/jingjinbao/ServerPilot/server:VERSION
  docker pull ghcr.io/jingjinbao/ServerPilot/dashboard:VERSION
  ```
- [ ] Verify `docker compose up` works with the new version
- [ ] GitHub Release page shows correct CHANGELOG notes

### Announcement

- [ ] Update project README if needed
- [ ] Post release announcement (if applicable)

---

**Release command reference:**

```bash
# Preview (no changes made)
pnpm release v[VERSION] --dry-run

# Full release (creates tag + GitHub Release)
pnpm release v[VERSION]

# Create tag only (GitHub Release created by CI)
pnpm release v[VERSION] --skip-gh-release

# Push the tag to trigger CI
git push origin v[VERSION]
```
