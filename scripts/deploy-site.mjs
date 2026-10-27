#!/usr/bin/env node
// Publishes the built site (release-dist/) to Amplify Hosting: creates the
// Amplify app on first run, applies the routing rules generated from
// netlify.toml (with /api/* proxied to the stack's API Lambda), uploads the
// files plus customHttp.yml (headers), and waits until the deployment is live.
//
//   npm run build && AWS_PROFILE=makeable node scripts/deploy-site.mjs [--app-id d1pesirg786fm3] [--stack makeable-prod] [--branch main]
//
// --app-id picks the app directly (CI); without it the app is found or created by name.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zipSync } from "fflate";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every file under siteDir at its relative path, plus customHttp.yml at the root.
export function siteZip(siteDir, customHttpYaml) {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[path.relative(siteDir, full).split(path.sep).join("/")] = readFileSync(full);
    }
  };
  walk(siteDir);
  files["customHttp.yml"] = new TextEncoder().encode(customHttpYaml);
  return zipSync(files, { level: 6 });
}

// Amplify runs one deployment per branch at a time.
export function runningJobId(jobSummaries) {
  return jobSummaries.find((job) => job.status === "PENDING" || job.status === "RUNNING")?.jobId || "";
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const stackName = arg("--stack", "makeable-prod");
  const appName = arg("--app", `${stackName}-site`);
  const appId = arg("--app-id", "");
  const branchName = arg("--branch", "main");
  const siteDir = path.join(ROOT, "release-dist");
  const region = process.env.AWS_REGION || "us-east-1";

  const { CloudFormationClient, DescribeStacksCommand } = await import("@aws-sdk/client-cloudformation");
  const amplifySdk = await import("@aws-sdk/client-amplify");
  const { amplifyCustomHttp, amplifyRules, parseNetlifyToml } = await import("./amplify-site-config.mjs");

  const stack = (await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: stackName }))).Stacks[0];
  const apiOrigin = stack.Outputs.find((output) => output.OutputKey === "ApiUrl").OutputValue;
  const netlify = parseNetlifyToml(readFileSync(path.join(ROOT, "netlify.toml"), "utf8"));
  const rules = amplifyRules({ netlify, apiOrigin });

  const amplify = new amplifySdk.AmplifyClient({ region });
  let app = appId ? (await amplify.send(new amplifySdk.GetAppCommand({ appId }))).app : undefined;
  for (let nextToken; !app && !appId; ) {
    const page = await amplify.send(new amplifySdk.ListAppsCommand({ nextToken }));
    app = page.apps.find((candidate) => candidate.name === appName);
    nextToken = page.nextToken;
    if (!nextToken) break;
  }
  if (!app) {
    app = (await amplify.send(new amplifySdk.CreateAppCommand({
      name: appName,
      platform: "WEB",
      description: `Makeable site for stack ${stackName}`,
    }))).app;
    console.log(`created Amplify app ${app.appId}`);
  }
  try {
    await amplify.send(new amplifySdk.GetBranchCommand({ appId: app.appId, branchName }));
  } catch (error) {
    if (error.name !== "NotFoundException") throw error;
    await amplify.send(new amplifySdk.CreateBranchCommand({ appId: app.appId, branchName, stage: "PRODUCTION" }));
    console.log(`created branch ${branchName}`);
  }

  for (;;) {
    const jobs = (await amplify.send(new amplifySdk.ListJobsCommand({ appId: app.appId, branchName, maxResults: 5 }))).jobSummaries;
    const running = runningJobId(jobs);
    if (!running) break;
    console.log(`waiting for deployment ${running} to finish`);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  // Rules change only once no other deployment is mid-flight.
  await amplify.send(new amplifySdk.UpdateAppCommand({ appId: app.appId, customRules: rules }));
  console.log(`rules: ${rules.length} (api → ${apiOrigin})`);

  const zip = siteZip(siteDir, amplifyCustomHttp(netlify));
  console.log(`zip: ${(zip.length / 1048576).toFixed(1)} MB`);
  const deployment = await amplify.send(new amplifySdk.CreateDeploymentCommand({ appId: app.appId, branchName }));
  const upload = await fetch(deployment.zipUploadUrl, { method: "PUT", body: zip, headers: { "Content-Type": "application/zip" } });
  if (!upload.ok) throw new Error(`zip upload failed: HTTP ${upload.status}`);
  await amplify.send(new amplifySdk.StartDeploymentCommand({ appId: app.appId, branchName, jobId: deployment.jobId }));

  let status = "";
  while (!["SUCCEED", "FAILED", "CANCELLED"].includes(status)) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    status = (await amplify.send(new amplifySdk.GetJobCommand({ appId: app.appId, branchName, jobId: deployment.jobId }))).job.summary.status;
    console.log(`deployment ${deployment.jobId}: ${status}`);
  }
  if (status !== "SUCCEED") process.exit(1);
  console.log(`live: https://${branchName}.${app.defaultDomain}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
