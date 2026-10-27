import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

// Copies every key of one JSON secret into env at cold start, so secrets never
// sit in the Lambda's configuration. Values already set on the function win.
export async function loadSecretsIntoEnv({
  secretId = process.env.MAKEABLE_SECRET_ID || "",
  env = process.env,
  client,
} = {}) {
  if (!secretId) return;
  const result = await (client || new SecretsManagerClient({})).send(new GetSecretValueCommand({ SecretId: secretId }));
  let values;
  try {
    values = JSON.parse(result.SecretString || "");
  } catch {
    throw new Error(`Secret ${secretId} is not a JSON object`);
  }
  for (const [key, value] of Object.entries(values)) {
    if (env[key] === undefined || env[key] === "") env[key] = String(value);
  }
}
