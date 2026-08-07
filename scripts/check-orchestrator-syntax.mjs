import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  execFileText,
  orchestratorRoot
} from "./lib/orchestrator-utils.mjs";

const files = [];
await collect(join(orchestratorRoot, "scripts"));
await collect(join(orchestratorRoot, "dashboard"));

const failures = [];
for (const file of files) {
  try {
    await execFileText(process.execPath, ["--check", file], 30000);
  } catch (error) {
    failures.push({
      file,
      message: error.stderr || error.stdout || error.message
    });
  }
}

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}

console.log(`Syntaxe OK: ${files.length} fichier(s).`);

async function collect(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "reports", "backups", "archives"].includes(entry.name)) continue;
      await collect(fullPath);
      continue;
    }
    if (entry.isFile() && /\.(mjs|js)$/i.test(entry.name)) files.push(fullPath);
  }
}
