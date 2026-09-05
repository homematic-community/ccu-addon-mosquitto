# Task 10 — First release ✅

Completed 2026-09-05: `2.1.2+0` is published as the latest release of
[homematic-community/ccu-addon-mosquitto](https://github.com/homematic-community/ccu-addon-mosquitto/releases/tag/2.1.2%2B0).

- After the final smoke test on the three lab systems `master` was pushed
  (head `23f871b`); `ci` (run 33960955063) and `build-release`
  (run 33960960657, workflow_dispatch) were green on the first attempt after
  two fixes found on the way: the build scripts, service scripts and CGIs
  needed their execute bit in git, and the "incomplete bridge is left out"
  fix had not been committed.
- The workflow created tag `2.1.2+0` and a draft prerelease with the three
  tarballs, their `.sha256` files and the generated body (downloads,
  `docs/RELEASE_NOTES.md`, change list). The draft was reviewed and
  published with `gh release edit --draft=false --prerelease=false --latest`,
  so `releases/latest` moved from `1.5.8+4` to `2.1.2+0`.
- Verified afterwards: `update_check.cgi` on all three lab boxes reports
  `2.1.2+0` (they already run it, so no update is offered). The repository
  variable `AUTO_RELEASE_PUBLISH=true` is set, so `auto-release.yml`
  publishes future Mosquitto releases directly.
- The 13 open issues (#3, #4, #9, #11–#16, #18–#21) were answered with the
  new release in mind and closed, each comment with a footer saying it was
  written by an AI agent on the maintainer's behalf.

Package sizes of the release: armv7l 2.7 MB, aarch64 2.7 MB, x86_64 3.3 MB.
