import { deployOptions } from "./options.mjs";
import { toScheduledHandler } from "../../lib/aws/lambda-http.mjs";
import { reapEnclosureJobs } from "../../netlify/functions/api.mjs";

// Every 5 minutes: stops enclosure jobs with no progress for 20 minutes or running over 60 (lib/enclosure-jobs.mjs).
export const handler = toScheduledHandler(reapEnclosureJobs, { deployContext: deployOptions().deployContext });
