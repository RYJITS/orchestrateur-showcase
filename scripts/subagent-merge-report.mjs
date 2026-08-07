import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  markdownTable,
  nowIso,
  orchestratorRoot,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const folder = join(orchestratorRoot, "reports", "subagents");
const files = existsSync(folder)
  ? (await readdir(folder)).filter((file) => file.endsWith(".json")).sort()
  : [];
const items = [];

for (const file of files.slice(-30)) {
  const fullPath = join(folder, file);
  const payload = JSON.parse(await readFile(fullPath, "utf8"));
  items.push({
    file,
    agent: payload.agent || payload.results?.agent || "unknown",
    status: payload.status || "report",
    task: payload.task || payload.results?.task || payload.id || "n/a"
  });
}

const report = await writeReport(
  "subagents",
  "subagent-merge-report",
  `# Synthese rapports subagents

- Date: ${nowIso()}
- Rapports lus: ${items.length}

${markdownTable(["Fichier", "Agent", "Statut", "Tache"], items.map((item) => [item.file, item.agent, item.status, item.task]))}
`,
  { generatedAt: nowIso(), items }
);

console.log(`Synthese subagents terminee: ${items.length} rapport(s).`);
console.log(`Rapport: ${report.mdPath}`);
