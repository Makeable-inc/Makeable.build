import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const landingOutput = path.join(root, "apps", "landing", "out");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(landingOutput, output, { recursive: true });
await cp(path.join(root, "privacy"), path.join(output, "privacy"), { recursive: true });
await cp(path.join(root, "terms"), path.join(output, "terms"), { recursive: true });
await cp(path.join(root, "ember"), path.join(output, "ember"), { recursive: true });
await cp(path.join(root, "robots.txt"), path.join(output, "robots.txt"));
await cp(path.join(root, "sitemap.xml"), path.join(output, "sitemap.xml"));
await cp(path.join(root, "styles"), path.join(output, "styles"), { recursive: true });
await cp(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });
await cp(path.join(root, "dashboard"), path.join(output, "dashboard"), { recursive: true });
await cp(path.join(root, "pilot"), path.join(output, "pilot"), { recursive: true });
await cp(path.join(root, "pilot", "index.html"), path.join(output, "pilot-app.html"));
await rm(path.join(output, "pilot", "index.html"));
await cp(path.join(root, "pilot-coming-soon.html"), path.join(output, "pilot-coming-soon.html"));
