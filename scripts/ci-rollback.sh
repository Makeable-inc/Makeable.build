#!/usr/bin/env bash
# Redeploys the commit tagged aws-last-good (the last deploy whose smoke build
# passed), site first. Exits cleanly when no such tag exists yet: a failed
# CloudFormation change already undoes itself and Amplify keeps the old site.
set -euo pipefail

if ! git ls-remote --exit-code --tags origin aws-last-good > /dev/null; then
  echo "No aws-last-good tag yet: nothing to roll back to."
  exit 0
fi

git fetch --depth 1 origin tag aws-last-good
dir="$(mktemp -d)"
git worktree add --detach "$dir" aws-last-good
cd "$dir"
echo "Rolling back to $(git rev-parse --short HEAD)"
npm ci
npm run build
DEPLOY_ORDER=site-first bash scripts/ci-deploy.sh
