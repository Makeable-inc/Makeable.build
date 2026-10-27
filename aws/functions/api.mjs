import { deployOptions } from "./options.mjs";
import { toLambdaHandler } from "../../lib/aws/lambda-http.mjs";
import api from "../../netlify/functions/api.mjs";
import socialLink from "../../netlify/functions/social-link.mjs";

// On Netlify /r/* was its own function; here Amplify sends it to this Lambda.
const route = (request, context) =>
  new URL(request.url).pathname.startsWith("/r/") ? socialLink(request) : api(request, context);

export const handler = toLambdaHandler(route, deployOptions());
