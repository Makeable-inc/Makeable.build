#!/usr/bin/env bash
# Deploys the checked-out commit to AWS: backend first, then the website, then
# one real build through the site. Used by .github/workflows/deploy-aws.yml for
# both normal deploys and rollbacks, so both run exactly the same steps.
#
# Needs AWS credentials in the environment and these variables:
#   AWS_CFN_EXECUTION_ROLE_ARN  role CloudFormation uses to change the stack
#   AMPLIFY_APP_ID              Amplify app of the site
#   AMPLIFY_SITE_URL            https://main.<id>.amplifyapp.com (later https://makeable.build)
set -euo pipefail

: "${AWS_CFN_EXECUTION_ROLE_ARN:?}" "${AMPLIFY_APP_ID:?}" "${AMPLIFY_SITE_URL:?}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

echo "::group::Build website"
npm run build
echo "::endgroup::"

echo "::group::Build backend"
node scripts/build-lambda-bundle.mjs
sam build --config-env ci
echo "::endgroup::"

# Backend before website: a new backend must keep serving the old website for
# the minute until the new website is live.
echo "::group::Deploy backend"
sam deploy --config-env ci --role-arn "$AWS_CFN_EXECUTION_ROLE_ARN"
echo "::endgroup::"

echo "::group::Deploy website"
node scripts/deploy-site.mjs --app-id "$AMPLIFY_APP_ID"
echo "::endgroup::"

echo "::group::Smoke build"
node scripts/aws-smoke-build.mjs --base "$AMPLIFY_SITE_URL"
echo "::endgroup::"
