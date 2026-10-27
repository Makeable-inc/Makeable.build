import { toScheduledHandler } from "../../lib/aws/lambda-http.mjs";
import buildCleanup from "../../netlify/functions/build-cleanup.mjs";
import { deployContext } from "./options.mjs";

export const handler = toScheduledHandler(buildCleanup, { deployContext });
