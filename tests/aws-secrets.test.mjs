import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSecretsIntoEnv } from "../lib/aws/secrets.mjs";

function fakeSecretsClient(secretString) {
  const sent = [];
  return {
    sent,
    async send(command) {
      sent.push(command.input);
      if (secretString instanceof Error) throw secretString;
      return { SecretString: secretString };
    },
  };
}

test("every key in the secret becomes an env var", async () => {
  const env = {};
  const client = fakeSecretsClient(JSON.stringify({ OPENAI_API_KEY: "sk-test", STRIPE_SECRET_KEY: "rk-test" }));
  await loadSecretsIntoEnv({ client, secretId: "makeable/prod", env });
  assert.deepEqual(client.sent, [{ SecretId: "makeable/prod" }]);
  assert.equal(env.OPENAI_API_KEY, "sk-test");
  assert.equal(env.STRIPE_SECRET_KEY, "rk-test");
});

test("a value already set on the function wins over the secret", async () => {
  const env = { OPENAI_BASE_URL: "https://proxy.example" };
  await loadSecretsIntoEnv({
    client: fakeSecretsClient(JSON.stringify({ OPENAI_BASE_URL: "https://api.openai.com/v1" })),
    secretId: "makeable/prod",
    env,
  });
  assert.equal(env.OPENAI_BASE_URL, "https://proxy.example");
});

test("no secret id configured means nothing is loaded", async () => {
  const client = fakeSecretsClient("{}");
  await loadSecretsIntoEnv({ client, secretId: "", env: {} });
  assert.equal(client.sent.length, 0);
});

test("an unreadable secret stops the cold start instead of running without secrets", async () => {
  await assert.rejects(
    loadSecretsIntoEnv({ client: fakeSecretsClient(new Error("AccessDenied")), secretId: "makeable/prod", env: {} }),
    /AccessDenied/,
  );
  await assert.rejects(
    loadSecretsIntoEnv({ client: fakeSecretsClient("not json"), secretId: "makeable/prod", env: {} }),
    /makeable\/prod/,
  );
});
