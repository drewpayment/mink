# Releasing

Mink publishes to npm as `@drewpayment/mink`. The CLI's auto-update path
follows the `latest` dist-tag, so anything tagged `latest` reaches every user
on their next scheduled update.

## Normal release (`latest`)

Conventional commits land on `main` → `release-please` opens a release PR →
merging that PR cuts a tag and publishes to npm under the `latest` dist-tag.

This path is fully automated; nothing to do by hand.

## Pre-release (`beta`, `rc`, `alpha`)

Use a pre-release dist-tag whenever you want a build that can be installed
explicitly without auto-update picking it up. Typical reasons:

- Risky migrations (e.g. project-identity v3 in spec 20).
- Cross-machine convergence tests that need two real installs.
- Soaking new features for a week before promoting to `latest`.

### Cut a beta

1. Branch off the feature branch (don't reuse it — you don't want the version
   bump merging to `main`):

   ```bash
   git switch -c beta/0.11.0-beta.1
   ```

2. Bump `package.json` to the pre-release version:

   ```bash
   npm version 0.11.0-beta.1 --no-git-tag-version
   git commit -am "chore: publish 0.11.0-beta.1"
   git push -u origin beta/0.11.0-beta.1
   ```

   The version must end with `-beta.N`, `-rc.N`, or `-alpha.N`. The workflow
   rejects anything else and refuses to publish to `latest`.

3. GitHub → **Actions** → **Release** → **Run workflow** → pick the
   `beta/0.11.0-beta.1` branch. Leave the `dist_tag` input blank to derive it
   from the pre-release identifier (`beta`), or set it explicitly.

4. The workflow builds, tests, and publishes. The run summary prints the
   exact install command, e.g.:

   ```bash
   npm i -g @drewpayment/mink@beta
   ```

### Test the beta

On each test machine:

```bash
# Back up real state first
cp -r ~/.mink ~/.mink.backup-pre-beta

# Install the beta explicitly
npm i -g @drewpayment/mink@beta
mink --version    # confirms the pre-release version

# Optional: sandbox the test entirely
export MINK_HOME=~/.mink-sandbox
mink init
```

Auto-update will not pull this version — it only follows `latest`.

### Iterate

Each iteration bumps the pre-release counter:

```bash
npm version 0.11.0-beta.2 --no-git-tag-version
git commit -am "chore: publish 0.11.0-beta.2"
git push
# Run the workflow again against the same branch.
```

### Promote to `latest`

When the beta has soaked long enough, promote without re-publishing:

```bash
npm dist-tag add @drewpayment/mink@0.11.0-beta.N latest
```

After promoting, merge the feature branch (the original one, **without** the
pre-release version bump) into `main`. Release-please will then cut the real
`0.11.0` from conventional commits and publish it under `latest`.

The beta version stays on npm forever (registry policy), but no auto-update
client will install it once `latest` has moved on.

### Abandon a beta

If a beta is wrong, do nothing — there is no untagging or unpublishing. Just
cut the next pre-release (`-beta.N+1`) or never promote. `latest` is
unaffected.

## Manual `latest` release

If `release-please` is unhealthy and you need to ship `latest` by hand, cut
a GitHub Release through the UI. The `publish-from-manual-release` job picks
it up and publishes with the default `latest` tag.

## Safety rails

- The `publish-prerelease` job refuses to run unless `package.json` carries a
  pre-release identifier.
- The job refuses an explicit `dist_tag` of `latest`.
- `release-please` only runs on push to `main`, so dispatching the workflow
  from a feature branch cannot touch the release manifest.
