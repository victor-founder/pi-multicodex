#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

version="$(node -p "require('./package.json').version")"

echo "[pre-push] running CI-equivalent checks"
mise x -- pnpm check
mise x -- npm pack --dry-run >/dev/null

while read -r _local_ref local_sha _remote_ref _remote_sha; do
  if [[ "$local_sha" == "0000000000000000000000000000000000000000" ]]; then
    continue
  fi

  if [[ "$local_ref" =~ ^refs/tags/v(.+)$ ]]; then
    tag_version="${BASH_REMATCH[1]}"
    if [[ "$tag_version" != "$version" ]]; then
      echo "[pre-push] tag version v$tag_version does not match package.json version $version" >&2
      exit 1
    fi
  fi
done

echo "[pre-push] checks passed"
