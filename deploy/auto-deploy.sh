#!/usr/bin/env bash
set -Eeuo pipefail

repo=/home/ealtenho/lometa
state=/home/ealtenho/.local/state/lometa-auto-deploy
mkdir -p "$state"
exec 9>"$state/lock"
flock -n 9 || exit 0

cd "$repo"
if [[ "$(git branch --show-current)" != master ]] ||
   ! git diff --quiet || ! git diff --cached --quiet ||
   [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo 'Deployment stopped: the Pi checkout must be clean and on master.' >&2
  exit 1
fi

git fetch --quiet origin master
current=$(git rev-parse HEAD)
target=$(git rev-parse FETCH_HEAD)
[[ "$current" != "$target" ]] || exit 0

if [[ -f "$state/failed-commit" ]] && [[ "$(cat "$state/failed-commit")" == "$target" ]]; then
  echo "Skipping failed commit $target until master changes." >&2
  exit 1
fi
git merge-base --is-ancestor "$current" "$target" || {
  echo 'Deployment stopped: master cannot fast-forward to GitHub.' >&2
  exit 1
}

healthy() {
  for _ in {1..12}; do
    if curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/ >/dev/null; then
      return 0
    fi
    sleep 5
  done
  return 1
}

echo "Deploying $target from GitHub master"
git merge --ff-only "$target"
if sudo -n docker compose up -d --build && healthy; then
  printf '%s\n' "$target" >"$state/deployed-commit"
  rm -f "$state/failed-commit"
  echo "Deployed $target"
  exit 0
fi

echo "Deployment failed; restoring $current" >&2
printf '%s\n' "$target" >"$state/failed-commit"
if git diff --quiet && git diff --cached --quiet &&
   [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
  git reset --hard "$current"
  sudo -n docker compose up -d --build
  healthy || echo 'Rollback health check failed.' >&2
else
  echo 'Rollback stopped: the checkout changed during deployment.' >&2
fi
exit 1
