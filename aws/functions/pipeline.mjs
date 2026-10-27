import { toBackgroundEventHandler } from "../../lib/aws/lambda-http.mjs";
import buildBackground from "../../netlify/functions/build-background.mjs";
import { deployOptions } from "./options.mjs";

export const handler = toBackgroundEventHandler(buildBackground, { deployContext: deployOptions().deployContext });
