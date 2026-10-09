#!/usr/bin/env bash
# Runs a GPU script inside the pinned canonical golden environment (REQ-PIX-028, AC-PIX-028.1).
#
#   scripts/golden-env/run.sh test:gpu          # gate: compare with committed goldens
#   CSG_GOLDEN_REASON="why" scripts/golden-env/run.sh goldens:update   # rewrite changed goldens
#
# Inside, this is `pnpm <script>` (see root package.json).
# The image tag must equal the exact @playwright/test version (apps/web/package.json); bumping
# Playwright means a new tag + digest here and regenerated goldens.
set -euo pipefail

IMAGE_TAG="mcr.microsoft.com/playwright:v1.64.0-noble"
IMAGE_DIGEST="sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f"
IMAGE="${IMAGE_TAG}@${IMAGE_DIGEST}"

script="${1:?usage: run.sh <test:gpu|goldens:update|test:perf>}"
# pnpm is not in the image (and corepack cannot install it as a non-root user offline), so the root
# package.json scripts are mirrored here with the same variables. Keep in sync.
vitest="node node_modules/vitest/vitest.mjs run"
case "$script" in
  test:gpu) cmd="CSG_GPU=1 $vitest --project 'gpu-*'" ;;
  goldens:update) cmd="CSG_GPU=1 CSG_GOLDEN_UPDATE=1 $vitest --project 'gpu-*'" ;;
  # M2-19 perf suite (report only in the container): one backend at a time, so the two
  # software-rendered browsers do not compete for the CPU.
  test:perf)
    cmd="CSG_GPU=1 CSG_PERF=1 $vitest --project gpu-webgpu && CSG_GPU=1 CSG_PERF=1 $vitest --project gpu-webgl2"
    ;;
  *) echo "unsupported script: $script" >&2; exit 2 ;;
esac

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The digest can only be pulled by reference; fall back to the local tag if it is already present.
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker pull "$IMAGE"
fi

# Runs as the host user so written goldens and test-results keep their ownership. The repo (with its
# host-installed node_modules, linux-x64) is mounted read-write. --ipc=host avoids Chromium /dev/shm limits.
exec docker run --rm --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI="${CI:-}" \
  -e CSG_GOLDEN_ENV=canonical \
  -e CSG_GOLDEN_IMAGE="$IMAGE" \
  -e CSG_GOLDEN_REASON="${CSG_GOLDEN_REASON:-}" \
  -e CSG_GOLDEN_ALLOW_ENV_CHANGE="${CSG_GOLDEN_ALLOW_ENV_CHANGE:-}" \
  -e CSG_PERF_GATE="${CSG_PERF_GATE:-}" \
  -v "$repo:/work" -w /work \
  "$IMAGE" \
  bash -c "$cmd"
