#!/usr/bin/env bash
# Makes sure ECR has the enclosure generator's image for the checked-out commit, then points :latest at it.
# Fargate tasks (infra/enclosure.yml) always run :latest, so the next job uses it.
#
# The image is named after a fingerprint of everything enclosure/Dockerfile copies in: enclosure/, lib/ (the
# wiring compiler) and artifacts/aws-assembly-release (the part models). If ECR already has that fingerprint,
# nothing is built. A change in any of the three gives a new fingerprint and a new build.
#
# Used by .github/workflows/deploy-aws.yml before the app deploy, and by scripts/ci-rollback.sh inside the
# rollback commit's worktree, so a rollback also puts back that commit's image (rebuilt if ECR expired it;
# the repository keeps the last 5 images).
#
# Needs AWS credentials with ECR rights on makeable-enclosure (aws/github-deploy-role.yaml).
# ENCLOSURE_IMAGE_CHECK_ONLY=1 prints the fingerprint and whether it would build, and stops.
set -euo pipefail
export AWS_REGION="${AWS_REGION:-us-east-1}"
name=makeable-enclosure

# A missing path fails here, as the Dockerfile's COPY would.
fingerprint="$(git rev-parse HEAD:enclosure HEAD:lib HEAD:artifacts/aws-assembly-release | sha256sum | cut -c1-12)"
tag="src-${fingerprint}"

# batch-get-image succeeds with zero images when a tag is missing, so count the images.
found="$(aws ecr batch-get-image --repository-name "$name" --image-ids "imageTag=${tag}" --query 'length(images)' --output text)"
echo "enclosure image ${tag}: $([ "$found" = "0" ] && echo "not in ECR, will build" || echo "already in ECR")"
[ "${ENCLOSURE_IMAGE_CHECK_ONLY:-}" = "1" ] && exit 0

account="$(aws sts get-caller-identity --query Account --output text)"
registry="${account}.dkr.ecr.${AWS_REGION}.amazonaws.com"
repo="${registry}/${name}"
aws ecr get-login-password | docker login --username AWS --password-stdin "$registry"

if [ "$found" = "0" ]; then
  echo "::group::Build ${tag}"
  # Reuses unchanged layers (system and Python packages) from the image :latest points at.
  docker build --platform linux/amd64 -f enclosure/Dockerfile \
    --build-arg BUILDKIT_INLINE_CACHE=1 --cache-from "${repo}:latest" \
    -t "${repo}:${tag}" .
  echo "::endgroup::"
  docker push "${repo}:${tag}"
fi

# Point :latest at this image: the same manifest under a second tag, with no rebuild or upload. The manifest goes
# through a file byte for byte; any change to it (the CLI's text output adds one) makes ECR store a new image.
py=python3
"$py" -c "" 2>/dev/null || py=python
work="$(mktemp -d)"
aws ecr batch-get-image --repository-name "$name" --image-ids "imageTag=${tag}" --output json > "$work/image.json"
"$py" -c 'import json, sys; i = json.load(open(sys.argv[1]))["images"][0]; open(sys.argv[2], "w", newline="").write(i["imageManifest"]); print(i["imageManifestMediaType"])' \
  "$work/image.json" "$work/manifest.json" > "$work/media.txt"
media="$(cat "$work/media.txt")"
manifest_file="$work/manifest.json"
command -v cygpath >/dev/null && manifest_file="$(cygpath -w "$manifest_file")"  # Git Bash on Windows; CI is Linux
if ! out="$(aws ecr put-image --repository-name "$name" --image-tag latest --image-manifest "file://$manifest_file" --image-manifest-media-type "$media" 2>&1)"; then
  # Already pointing at this image is fine.
  if ! grep -q ImageAlreadyExistsException <<<"$out"; then
    echo "$out" >&2
    exit 1
  fi
fi
echo "latest -> ${tag}"
