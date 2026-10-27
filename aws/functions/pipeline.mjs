import { toBackgroundEventHandler } from "../../lib/aws/lambda-http.mjs";
import buildBackground from "../../netlify/functions/build-background.mjs";
import { deployContext } from "./options.mjs";

export const handler = toBackgroundEventHandler(buildBackground, { deployContext });
