import {
  nowIso,
  parseArgs,
  writeReport
} from "./lib/orchestrator-utils.mjs";
import {
  buildAllProjectsContext,
  buildPrompt,
  callQwen,
  loadSubagentEnv,
  renderContextMarkdown
} from "./lib/subagent-api-utils.mjs";

const args = parseArgs();
const task = String(args.task || args._.join(" ") || "Analyse non specifiee");
const action = String(args.action || "analyse");
const useApi = Boolean(args.api || args.send);
const context = await buildAllProjectsContext(action, task);
const envInfo = await loadSubagentEnv();
const apiResult = useApi
  ? await callQwen({ env: envInfo.env, prompt: buildPrompt(context, "Alibaba/Qwen API") })
  : {
      sent: false,
      status: "NOT_SENT_DRY_RUN",
      reason: "Option --api absente"
    };
const result = {
  generatedAt: nowIso(),
  agent: "qwen",
  executor: "alibaba-api",
  mode: useApi ? "api" : "dry-run",
  task,
  action,
  projectCount: context.projectCount,
  status: apiResult.status,
  apiCall: apiResult.sent ? "oui" : "non",
  apiModel: apiResult.model || null,
  apiReason: apiResult.reason || null,
  response: apiResult.content || "",
  notes: [
    "Qwen/Alibaba reste sous-agent d'analyse: aucune modification directe.",
    "Le contexte envoye contient les metadonnees du registre, pas les fichiers ni les secrets.",
    "Si la configuration API manque, le rapport est produit sans appel externe."
  ]
};

const report = await writeReport(
  "subagents",
  "subagent-qwen",
  `# Subagent Qwen / Alibaba

- Date: ${result.generatedAt}
- Tache: ${task}
- Action: ${action}
- Projets couverts: ${context.projectCount}
- Mode: ${result.mode}
- Appel API: ${result.apiCall}
- Statut: ${result.status}
${result.apiReason ? `- Raison: ${result.apiReason}\n` : ""}

## Projets concernes
${renderContextMarkdown(context)}

${result.response ? `## Reponse Qwen / Alibaba\n${result.response}\n` : ""}

## Notes
${result.notes.map((item) => `- ${item}`).join("\n")}
`,
  result
);

console.log(`Subagent Qwen / Alibaba: ${result.status}.`);
console.log(`Rapport: ${report.mdPath}`);
