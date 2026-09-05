# Task 1 — Repository and tooling modernization ✅

Completed 2026-09-05.

- Checked-in binaries and libraries (`addon_files/mosquitto/bin`, `lib`:
  mosquitto 1.5.8, libcrypto 1.1, libwebsockets 8, libev) removed — they
  are build output now (task 2). The old service script, `conf.d` layout
  and raw-VERSION update check were replaced in tasks 3–5.
- `.gitattributes` (`* text=auto eol=lf`), `.editorconfig`, renormalized
  checkout (the Windows clone had CRLF on every file), `.gitignore` for
  `addon_tmp/`, `dist/`, `RELEASE_BODY.md`, `RELEASE_SUMMARY.md`.
- `AGENTS.md` (+ `CLAUDE.md`) with layout, conventions, the WSL-only and
  "one commit per change, no push/tag/release without the maintainer"
  rules; `ROADMAP.md` + `roadmap-archive/`.
- `package.json` is the single place for the addon version
  (`<mosquitto>+<build>`) and the build/test scripts; no Node.js on the
  CCU, node only drives the build helpers.
- License files untouched (dual EPL-1.0/EDL-1.0 for the addon; Mosquitto
  2.x itself is EPL-2.0/EDL-1.0, listed on the addon's licenses page).
