# Task 7 — Version scheme and automatic releases ✅

Completed 2026-09-05 (`update_versions.js`, `.github/workflows/auto-release.yml`,
`build_release_body.sh`).

- Addon version = `<mosquitto version>+<addon build>` in `package.json`:
  `2.1.2+0` is the first package of Mosquitto 2.1.2, `2.1.2+1` an
  addon-only change, the next Mosquitto release starts at `+0` again.
  Tags carry the version without `v`, asset names the literal `+`
  (worked for `1.5.8+4`; GitHub encodes it as `%2B` in URLs, the
  update worker and the release body do the same).
- `update_versions.js` reads the release tags of
  eclipse-mosquitto/mosquitto (plain `vX.Y.Z`, no release candidates —
  Mosquitto publishes no GitHub releases, only tags), compares within the
  pinned major, and with `--apply` sets `<newest>+0` and writes
  `RELEASE_SUMMARY.md`; `--bump` raises the addon build for forced runs.
  A new Mosquitto major is reported (`major=true`) but never applied.
- `auto-release.yml` (daily 05:17 UTC, `workflow_dispatch` with `force`):
  check → bump → qemu + patchelf → `build.sh` → `test/e2e.sh` → commit
  `package.json` → release (draft unless the repository variable
  `AUTO_RELEASE_PUBLISH` is `true`); an issue on failure and an issue on
  a Mosquitto major release.
- `build_release_body.sh`: downloads per architecture with encoded links,
  install hint, the automatic-release summary, `docs/RELEASE_NOTES.md`,
  commits since the last tag, component versions from the `versions`
  file, build link.
