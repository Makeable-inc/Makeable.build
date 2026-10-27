import { deployOptions } from "./options.mjs";
import { toScheduledHandler } from "../../lib/aws/lambda-http.mjs";
import buildCleanup from "../../netlify/functions/build-cleanup.mjs";

export const handler = toScheduledHandler(buildCleanup, { deployContext: deployOptions().deployContext });
