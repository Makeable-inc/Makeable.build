import { toLambdaHandler } from "../../lib/aws/lambda-http.mjs";
import socialLink from "../../netlify/functions/social-link.mjs";
import { deployOptions } from "./options.mjs";

export const handler = toLambdaHandler(socialLink, deployOptions());
