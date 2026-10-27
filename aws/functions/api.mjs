import { deployOptions } from "./options.mjs";
import { toLambdaHandler } from "../../lib/aws/lambda-http.mjs";
import api from "../../netlify/functions/api.mjs";

export const handler = toLambdaHandler(api, deployOptions());
