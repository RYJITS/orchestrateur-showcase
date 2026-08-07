import {
  nowIso,
  parseArgs,
  writeReport
} from "./lib/orchestrator-utils.mjs";
import {
  buildAllProjectsContext,
  buildPrompt,
  callMistral,
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
  ? await callMistral({ env: envInfo.env, prompt: buildPrompt(context, "Mistral API") })
  : {
      sent: false,
      status: "NOT_SENT_DRY_RUN",
      reason: "Option --api absente"
    };
const result = {
  generatedAt: nowIso(),
  agent: "mistral",
  executor: "mistral-api",
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
    "Mistral reste sous-agent d'analyse: aucune modification directe.",
    "Le contexte envoye contient les metadonnees du registre, pas les fichiers ni les secrets.",
    "Si la configuration API manque, le rapport est produit sans appel externe."
  ]
};

const report = await writeReport(
  "subagents",
  "subagent-mistral",
  `# Subagent Mistral

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

${result.response ? `## Reponse Mistral\n${result.response}\n` : ""}

## Notes
${result.notes.map((item) => `- ${item}`).join("\n")}
`,
  result
);

console.log(`Subagent Mistral: ${result.status}.`);
console.log(`Rapport: ${report.mdPath}`);
