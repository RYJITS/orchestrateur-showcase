import { join } from "node:path";
import {
  nowIso,
  orchestratorRoot,
  parseArgs,
  slugify,
  stamp,
  writeJson,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const agent = String(args.agent || "manual").toLowerCase();
const task = String(args.task || args._.join(" ") || "Analyse projet demandee");
const id = `${stamp()}-${slugify(agent)}-${slugify(task).slice(0, 48)}`;
const payload = {
  id,
  createdAt: nowIso(),
  agent: ["mistral", "qwen"].includes(agent) ? agent : "manual",
  mode: "analysis-only",
  project: args.project || null,
  task,
  context: {
    source: "00_ORCHESTRATEUR",
    noDirectExecution: true,
    noDirectWrite: true,
    noSecrets: true,
    outputDirectory: "reports/subagents"
  },
  constraints: {
    analysisOnly: true,
    noDirectWrite: true,
    noSecrets: true,
    noPublication: true,
    noApiCallWithoutExplicitApproval: true
  },
  expectedOutput: {
    summary: "string",
    risks: [],
    recommendations: [],
    proposedFiles: [],
    tests: []
  }
};

const taskPath = join(orchestratorRoot, "reports", "subagents", `${id}.task.json`);
await writeJson(taskPath, payload);
const report = await writeReport(
  "subagents",
  "subagent-dispatch",
  `# Tache subagent preparee

- Date: ${payload.createdAt}
- Agent: ${payload.agent}
- Mode: ${payload.mode}
- Execution externe: non
- Ecriture directe projet: non
- Secrets: non transmis
- Tache: ${payload.task}
- Fichier: \`${taskPath}\`
`,
  payload
);

console.log(`Tache subagent preparee: ${taskPath}`);
console.log(`Rapport: ${report.mdPath}`);
