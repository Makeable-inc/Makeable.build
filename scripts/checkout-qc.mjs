// Isolated local preview: dummy credentials and blocked outside services.
import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["scripts/dev-local.mjs", "--fake-stripe", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, STRIPE_SECRET_KEY: "sk_test_local_qc", STRIPE_WEBHOOK_SECRET: "whsec_local_qc", OPENAI_API_KEY: "", GOOGLE_CLIENT_ID: "", POSTHOG_PERSONAL_API_KEY: "", POSTHOG_PROJECT_ID: "", NEXT_PUBLIC_POSTHOG_KEY: "" },
});
child.on("exit", (code) => process.exit(code ?? 1));
