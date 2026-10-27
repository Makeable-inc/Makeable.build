import { deployOptions } from "./options.mjs";
import { toScheduledHandler } from "../../lib/aws/lambda-http.mjs";
import socialRefresh from "../../netlify/functions/social-refresh.mjs";

export const handler = toScheduledHandler(socialRefresh, { deployContext: deployOptions().deployContext });
