import { toScheduledHandler } from "../../lib/aws/lambda-http.mjs";
import socialRefresh from "../../netlify/functions/social-refresh.mjs";
import { deployContext } from "./options.mjs";

export const handler = toScheduledHandler(socialRefresh, { deployContext });
