import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  defaultProjectsRoot,
  defaultSiteRoot,
  ensureDir,
  loadRegistry,
  nowIso,
  parseArgs,
  saveRegistry,
  writeJson
} from "./lib/orchestrator-utils.mjs";

const require = createRequire(import.meta.url);
const sharp = require(join(defaultProjectsRoot, "..", "Conpetances", "node_modules", "sharp"));
const args = parseArgs();
const projectId = String(args.projectId || args.project || "").trim();

if (!projectId) {
  throw new Error("Usage: node scripts/import-latest-ai-thumbnail.mjs --project-id <id>");
}

const source = args.source
  ? { path: resolve(String(args.source)) }
  : await latestGeneratedImage();
if (!source) throw new Error("Aucune image generee trouvee dans .codex/generated_images.");
if (!existsSync(source.path)) throw new Error(`Source image introuvable: ${source.path}`);

const thumbnailsRoot = join(defaultSiteRoot, "public", "orchestrator", "thumbnails-ai");
await ensureDir(thumbnailsRoot);
const target = join(thumbnailsRoot, `${projectId}.webp`);

await sharp(source.path)
  .resize(1280, 720, { fit: "cover", position: "center" })
  .modulate({ brightness: 1.18, saturation: 1.08 })
  .linear(1.08, 12)
  .sharpen({ sigma: 0.45, m1: 0.55, m2: 0.35 })
  .webp({ quality: 90, effort: 5 })
  .toFile(target);

const registry = await loadRegistry();
const project = registry.projects?.find?.((item) => item.id === projectId);
if (!project) throw new Error(`Projet introuvable dans le registre: ${projectId}`);

project.siteThumbnail = `public/orchestrator/thumbnails-ai/${projectId}.webp`;
project.thumbnailStatus = "AI_GENERATED_ORIGINAL_WEBP";
project.thumbnailSource = source.path;
project.updatedAt = nowIso();
registry.generatedAt = nowIso();
await saveRegistry(registry);

await writeJson(join(thumbnailsRoot, `${projectId}.meta.json`), {
  generatedAt: nowIso(),
  projectId,
  source: source.path,
  target,
  mode: "built-in-imagegen-import",
  processing: "resize-cover-1280x720-brightness-1.18-saturation-1.08-linear-1.08-offset-12-webp-q90"
});

console.log(`Vignette IA importee: ${projectId}`);
console.log(`Source: ${source.path}`);
console.log(`Cible: ${target}`);

async function latestGeneratedImage() {
  const root = resolve(process.env.USERPROFILE || process.env.HOME || "", ".codex", "generated_images");
  if (!existsSync(root)) return null;
  const files = [];
  await walk(root, files);
  return files
    .filter((item) => /\.(png|jpg|jpeg|webp)$/i.test(item.path))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

async function walk(folder, files) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(folder, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(fullPath).catch(() => null);
    if (!info) continue;
    files.push({ path: fullPath, mtimeMs: info.mtimeMs });
  }
}
