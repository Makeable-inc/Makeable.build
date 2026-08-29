import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = "makeable-production-prompt-package/v1";
const PROMPT_EXECUTORS = new Set(["openai_responses"]);

export async function loadProductionPromptPackage(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const packageRoot = path.join(root, "prompts", "production");
  const manifestPath = path.join(packageRoot, "manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));

  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported production prompt package schema: ${manifest.schemaVersion || "missing"}`);
  }
  if (!Array.isArray(manifest.stages) || manifest.stages.length === 0) {
    throw new Error("Production prompt package must declare at least one stage.");
  }

  const seen = new Set();
  const stages = new Map();
  for (const rawStage of manifest.stages) {
    validateStage(rawStage, seen);
    const stage = { ...rawStage, prompt: null, promptSha256: null, resolvedPromptPath: null };
    if (PROMPT_EXECUTORS.has(stage.executor)) {
      const resolvedPromptPath = safePromptPath(packageRoot, stage.promptPath);
      const prompt = await readFile(resolvedPromptPath, "utf8");
      if (!prompt.trim()) throw new Error(`Production prompt ${stage.id} is empty.`);
      stage.prompt = prompt.trim();
      stage.promptSha256 = sha256(Buffer.from(prompt));
      stage.resolvedPromptPath = resolvedPromptPath;
    } else if (stage.promptPath !== null) {
      throw new Error(`Non-Responses stage ${stage.id} cannot declare a developer prompt.`);
    }
    stages.set(stage.id, Object.freeze(stage));
  }

  for (const stage of stages.values()) {
    if (stage.promptFromStage && !stages.has(stage.promptFromStage)) {
      throw new Error(`Stage ${stage.id} references unknown prompt source ${stage.promptFromStage}.`);
    }
  }

  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    packageVersion: manifest.packageVersion,
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    manifest: Object.freeze(manifest),
    stages,
    stage(stageId) {
      const stage = stages.get(stageId);
      if (!stage) throw new Error(`Unknown production prompt stage: ${stageId}`);
      return stage;
    },
    prompt(stageId) {
      const stage = this.stage(stageId);
      if (!stage.prompt) throw new Error(`Production stage ${stageId} does not use a model prompt.`);
      return stage.prompt;
    },
  });
}

function validateStage(stage, seen) {
  if (!stage || typeof stage !== "object" || Array.isArray(stage)) throw new Error("Production prompt stage must be an object.");
  if (!/^[a-z][a-z0-9_]*$/.test(stage.id || "")) throw new Error(`Invalid production prompt stage id: ${stage.id || "missing"}`);
  if (seen.has(stage.id)) throw new Error(`Duplicate production prompt stage id: ${stage.id}`);
  seen.add(stage.id);
  for (const field of ["owner", "executor", "purpose", "outputContract"]) {
    if (typeof stage[field] !== "string" || !stage[field].trim()) throw new Error(`Production stage ${stage.id} is missing ${field}.`);
  }
  if (PROMPT_EXECUTORS.has(stage.executor)) {
    if (typeof stage.promptPath !== "string" || !stage.promptPath.endsWith(".md")) {
      throw new Error(`Responses stage ${stage.id} must declare a Markdown prompt.`);
    }
  } else if (stage.promptPath !== null) {
    throw new Error(`Production stage ${stage.id} must use promptPath: null.`);
  }
}

function safePromptPath(packageRoot, relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error("Production prompt paths must be relative.");
  const candidate = path.resolve(packageRoot, relativePath);
  if (!candidate.startsWith(`${packageRoot}${path.sep}`)) throw new Error(`Production prompt escapes package root: ${relativePath}`);
  return candidate;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
