import { toLambdaHandler } from "../../lib/aws/lambda-http.mjs";
import api from "../../netlify/functions/api.mjs";
import { deployContext, trustedProxyHops } from "./options.mjs";

export const handler = toLambdaHandler(api, { deployContext, trustedProxyHops });
