#!/usr/bin/env bash
# Builds and pushes the enclosure generator's container image (enclosure/Dockerfile) to ECR, when anything under
# enclosure/ changed since the last good deploy. Fargate tasks (infra/enclosure.yml) always run :latest, so the
# next job uses it. Used by .github/workflows/deploy-aws.yml after a successful deploy.
#
# Each image is tagged with its commit as well as latest. To go back to an older image (ECR keeps the last 5):
#   aws ecr batch-get-image --repository-name makeable-enclosure --image-ids imageTag=<commit> \
#     --query 'images[0].imageManifest' --output text > manifest.json
#   aws ecr put-image --repository-name makeable-enclosure --image-tag latest --image-manifest file://manifest.json
#
# Needs AWS credentials with ECR push rights on makeable-enclosure (aws/github-deploy-role.yaml).
set -euo pipefail
export AWS_REGION="${AWS_REGION:-us-east-1}"

if git rev-parse -q --verify refs/tags/aws-last-good >/dev/null && git diff --quiet aws-last-good HEAD -- enclosure/; then
  echo "enclosure/ unchanged since aws-last-good: image not rebuilt"
  exit 0
fi

account="$(aws sts get-caller-identity --query Account --output text)"
registry="${account}.dkr.ecr.${AWS_REGION}.amazonaws.com"
repo="${registry}/makeable-enclosure"
commit="$(git rev-parse --short=12 HEAD)"

echo "::group::Build enclosure image ${commit}"
docker build --platform linux/amd64 -f enclosure/Dockerfile -t "${repo}:${commit}" -t "${repo}:latest" .
echo "::endgroup::"

aws ecr get-login-password | docker login --username AWS --password-stdin "${registry}"
docker push "${repo}:${commit}"
docker push "${repo}:latest"
echo "pushed ${repo}:${commit} and :latest"
