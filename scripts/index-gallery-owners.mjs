#!/usr/bin/env node
// Writes the My projects owner pointers for every existing build in the AWS
// data bucket (lib/build-jobs.mjs indexAllGalleryOwners). Re-runnable. Run
// after each data copy from Netlify so users' first visit is fast too; without
// it each user's first visit indexes them (one slow load).
//
//   AWS_PROFILE=makeable node scripts/index-gallery-owners.mjs [--stack makeable-prod]
//
// Prints counts only.
import { pathToFileURL } from "node:url";

async function main() {
  const args = process.argv.slice(2);
  const stackName = args.includes("--stack") ? args[args.indexOf("--stack") + 1] : "makeable-prod";
  const region = process.env.AWS_REGION || "us-east-1";
  const { CloudFormationClient, DescribeStacksCommand } = await import("@aws-sdk/client-cloudformation");
  const stack = (await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: stackName }))).Stacks[0];
  process.env.AWS_REGION = region;
  process.env.MAKEABLE_STORAGE_BACKEND = "s3";
  process.env.MAKEABLE_STORAGE_BUCKET = stack.Outputs.find((output) => output.OutputKey === "DataBucketName").OutputValue;
  const deployContext = stack.Parameters.find((p) => p.ParameterKey === "DeployContext").ParameterValue;

  const { openStore } = await import("../lib/storage/index.mjs");
  const { buildCommunityStoreName, indexAllGalleryOwners } = await import("../lib/build-jobs.mjs");
  // gallery/ and owners/ both live in the community store.
  const store = openStore({ name: buildCommunityStoreName(deployContext) });
  const result = await indexAllGalleryOwners(store);
  console.log(`indexed ${result.owners} owners, ${result.pointers} builds`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
