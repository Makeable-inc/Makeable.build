#!/usr/bin/env bash
# Deploys the checked-out, already built commit (npm run build) to AWS, then
# runs one real build through the site. Used by .github/workflows/deploy-aws.yml
# for deploys and, through scripts/ci-rollback.sh, for rollbacks.
#
# Needs AWS credentials in the environment and these variables:
#   AWS_CFN_EXECUTION_ROLE_ARN  role CloudFormation uses to change the stack
#   AMPLIFY_APP_ID              Amplify app of the site
#   AMPLIFY_SITE_URL            https://main.<id>.amplifyapp.com (later https://makeable.build)
#   DEPLOY_ORDER                backend-first (default) or site-first (rollback)
set -euo pipefail

: "${AWS_CFN_EXECUTION_ROLE_ARN:?}" "${AMPLIFY_APP_ID:?}" "${AMPLIFY_SITE_URL:?}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

deploy_backend() {
  echo "::group::Deploy backend"
  node scripts/build-lambda-bundle.mjs
  sam build
  sam deploy --no-confirm-changeset --role-arn "$AWS_CFN_EXECUTION_ROLE_ARN"
  echo "::endgroup::"
}

deploy_site() {
  echo "::group::Deploy website"
  node scripts/deploy-site.mjs --app-id "$AMPLIFY_APP_ID"
  echo "::endgroup::"
}

# A new site may need a new backend, but an old site works with a new backend.
# So a deploy goes backend first and a rollback goes site first: users never get
# a site newer than the backend behind it.
if [ "${DEPLOY_ORDER:-backend-first}" = "site-first" ]; then
  deploy_site
  deploy_backend
else
  deploy_backend
  deploy_site
fi

# The AI step sometimes fails on its own; one retry keeps a flake from rolling
# back a good deploy.
echo "::group::Smoke build"
node scripts/aws-smoke-build.mjs --base "$AMPLIFY_SITE_URL" \
  || { echo "smoke build failed, retrying once"; node scripts/aws-smoke-build.mjs --base "$AMPLIFY_SITE_URL"; }
echo "::endgroup::"
