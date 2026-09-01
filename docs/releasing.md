# Releasing Pegarr

Pegarr releases are immutable Git tags and multi-architecture GHCR images. The GitHub repository and container package are public surfaces with independent visibility; verify both for every release.

## Release boundary

A release may contain explicit manual gaps. Those gaps must stay visible in `harness/manifest.json` and the release notes, and the release must not be described as production-proven where installed-service evidence is still open. Never use a live Grab as an automated release check.

## Prepare the exact commit

1. Choose a semantic version and update `package.json`, `package-lock.json`, and `CHANGELOG.md` together.
2. Replace the changelog's `Pending` date only when the release commit is ready.
3. Confirm that the release notes list every unresolved `PEG-MANUAL-*` boundary relevant to the release.
4. Run the exact local gate:

   ```console
   npm ci
   npm run check
   git diff --check
   ```

5. Commit and push the release commit. Record its full Git SHA.
6. Require both the `CI` and `Container` workflows to succeed for that exact SHA. Do not substitute a successful run from an earlier commit.

## Verify the published candidate

Before tagging, verify all of the following against the candidate image from the release commit:

- an unauthenticated GHCR pull succeeds;
- the image index contains `linux/amd64` and `linux/arm64` manifests;
- `/health/ready` returns ready from the pulled image;
- `/api/v1/version` returns the package version and the exact release-commit SHA;
- the image has been exercised in the approved read-only deployment sequence, using its immutable digest and a preserved rollback unit.

Treat the source repository and GHCR package as separately public. A public repository does not prove anonymous container pulls.

## Tag and publish

Tagging and creating a GitHub release are explicit publishing actions. Perform them only after the exact-commit checks above are green and the operator has approved the release:

```console
git tag -a v0.1.0 -m "Pegarr v0.1.0"
git push origin v0.1.0
```

Wait for the tag-triggered `Container` workflow, then verify that the immutable digest is available through the full version tag and expected semantic-version aliases. Create the GitHub release from `CHANGELOG.md`, retaining the manual boundaries and known limitations. Mark it as a prerelease when the evidence does not yet support a stable claim.

## Deployment and rollback

Deploy the released digest or full semantic version, never a mutable branch tag. Verify readiness, authentication, persistent settings, bounded read-only upstream access, and redacted logs before considering the rollout complete.

Rollback by restoring the previously exported stack definition or prior immutable digest. Preserve the existing Arr/Bazarr mounts, paths, and data; never recreate the whole media stack from the repository example.
