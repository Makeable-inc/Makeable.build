import { toLambdaHandler } from "../../lib/aws/lambda-http.mjs";
import api from "../../netlify/functions/api.mjs";
import { deployOptions } from "./options.mjs";

export const handler = toLambdaHandler(api, deployOptions());
