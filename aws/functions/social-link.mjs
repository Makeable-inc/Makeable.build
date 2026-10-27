import { toLambdaHandler } from "../../lib/aws/lambda-http.mjs";
import socialLink from "../../netlify/functions/social-link.mjs";
import { deployContext, trustedProxyHops } from "./options.mjs";

export const handler = toLambdaHandler(socialLink, { deployContext, trustedProxyHops });
