# Task 20 — every aarch64 release so far was an armv7l package ✅

Found and fixed 2026-09-06 while verifying the `2.1.2+2` release, released as
`2.1.2+3`.

## What was wrong

`mosquitto-aarch64-<version>.tar.gz` of `2.1.2+0`, `2.1.2+1` and `2.1.2+2`
contains **32-bit ARM binaries**: `e_machine = EM_ARM`, ELF class 32,
`lib/ld-musl-armhf.so.1`. The `versions` file in the same package says
`export ADDON_ARCH=aarch64`, so `update_script`'s `uname -m` check passes on a
64-bit box, the addon installs, and Mosquitto then cannot be executed at all.
armv7l and x86_64 were never affected — they happen to be the first and the
last build, and the first is the one whose image ends up in the cache.

Noticed by the size: the CI-built aarch64 asset was 2.72 MB where the same
build on the maintainer's machine produces 3.59 MB. Then confirmed on the
published assets of all three releases by reading the ELF header.

## Cause

`build.sh` builds the three architectures one after another in a single job.
`build_addon.sh` ran

    docker run --rm --platform linux/arm64 ... alpine:3.22 ...

and `--platform` on `docker run` is not enough: when the tag is already in the
local image store — put there by the armv7l build a minute earlier — some
Docker versions reuse that image and ignore the requested platform. The
container is then armv7, the build inside it produces armhf binaries, and the
script labels the package `aarch64` from its own `$ARCH` variable, which never
came from the container. The GitHub runner behaves this way; a current Docker
with the containerd image store re-resolves the manifest and does not, which is
why it never showed up in local builds.

`ci.yml` builds one architecture per matrix runner, so its packages are fine —
only the release path (`build.sh`, used by `build.yml` and `auto-release.yml`)
puts all three in one job.

## Fix

- `docker pull -q --platform $PLATFORM alpine:$ALPINE_TAG` before the run, so
  the right image is in the store no matter what was there before.
- **A hard self-check**: each architecture knows the musl loader only its own
  binaries ask for (`ld-musl-armhf.so.1`, `ld-musl-aarch64.so.1`,
  `ld-musl-x86_64.so.1`), and the build aborts before packaging if
  `patchelf --print-interpreter` on the built broker disagrees. The pull is the
  fix; this is the guarantee, and it would have caught the bug on the day it
  started. A package that cannot run must never be produced, let alone named
  after the architecture it cannot run on.

Verified: the guard fed the published (broken) `2.1.2+2` aarch64 binary prints
`error: aarch64 build produced binaries for ld-musl-armhf.so.1, expected
ld-musl-aarch64.so.1` and exits 1; fed a correct build it passes. All three
architectures rebuilt with the fix and checked by ELF header.

## Left for the maintainer

The broken assets of `2.1.2+0`, `2.1.2+1` and `2.1.2+2` are still on the
releases page. `2.1.2+3` is latest and the release notes name the problem, but
whether to delete or relabel those three assets is the maintainer's call.
