import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  markdownTable,
  nowIso,
  orchestratorRoot,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const cerveauRoot = resolve(orchestratorRoot, "..", "..");
const envLocalPath = join(cerveauRoot, "API", "env.Local");
const subagentScripts = {
  dispatch: join(orchestratorRoot, "scripts", "subagent-dispatch.mjs"),
  mistral: join(orchestratorRoot, "scripts", "subagent-mistral.mjs"),
  qwen: join(orchestratorRoot, "scripts", "subagent-qwen.mjs"),
  merge: join(orchestratorRoot, "scripts", "subagent-merge-report.mjs")
};
const schemaPath = join(orchestratorRoot, "schemas", "subagent-task.schema.json");
const envAliases = {
  MISTRAL_API_KEY: ["MISTRAL_API_KEY", "MISTRAL.API_KEY"],
  MISTRAL_MODEL: ["MISTRAL_MODEL"],
  QWEN_API_KEY: ["QWEN_API_KEY", "Alibaba_API_KEY"],
  QWEN_BASE_URL: ["QWEN_BASE_URL"],
  QWEN_MODEL: ["QWEN_MODEL"]
};
const envDefaults = {
  MISTRAL_MODEL: "mistral-small-latest",
  QWEN_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  QWEN_MODEL: "qwen-plus"
};
const networkPatterns = [
  "fetch(",
  "axios",
  "https.request",
  "http.request",
  "node:https",
  "node:http",
  "@mistralai",
  "dashscope",
  "openai.chat",
  "process.env"
];
const destructivePatterns = [
  "unlink(",
  "rm(",
  "rmdir(",
  "rename(",
  "copyFile(",
  "cp(",
  "writeFile(",
  "appendFile(",
  "spawn(",
  "exec(",
  "execFile("
];
const checks = [];

const envNames = await readEnvNames(envLocalPath);
addCheck("env.Local existe", existsSync(envLocalPath), "D:/00_Cerveau_IA/API/env.Local");
for (const [name, aliases] of Object.entries(envAliases)) {
  const presentAliases = aliases.filter((alias) => envNames.has(alias));
  const isKey = name.endsWith("_API_KEY");
  const defaultValue = envDefaults[name];
  addCheck(
    `Variable ${name}`,
    presentAliases.length > 0 || defaultValue ? true : isKey ? false : "WARN",
    presentAliases.length > 0
      ? `alias present: ${presentAliases.join(", ")}`
      : defaultValue
        ? `defaut utilise: ${defaultValue}`
      : `alias absent: ${aliases.join(", ")}`
  );
}

const scriptContents = {};
for (const [name, path] of Object.entries(subagentScripts)) {
  scriptContents[name] = await safeRead(path);
  addCheck(`Script ${name} existe`, existsSync(path), path);
}

for (const [name, content] of Object.entries(scriptContents)) {
  if (!content) continue;
  const networkHits = findPatterns(content, networkPatterns);
  addCheck(`Script ${name} sans appel API direct`, networkHits.length === 0, networkHits.join(", ") || "aucun pattern reseau/env");

  const destructiveHits = findPatterns(content, destructivePatterns);
  addCheck(`Script ${name} sans execution/ecriture directe`, destructiveHits.length === 0, destructiveHits.join(", ") || "lecture/rapport uniquement");
}

addCheck(
  "Dispatch limite aux rapports subagents",
  scriptContents.dispatch?.includes('join(orchestratorRoot, "reports", "subagents"') && scriptContents.dispatch?.includes("writeJson(taskPath, payload)"),
  "taskPath sous reports/subagents"
);
addCheck(
  "Dispatch declare les contraintes",
  ["analysisOnly", "noDirectWrite", "noSecrets", "noPublication", "noApiCallWithoutExplicitApproval"].every((needle) => scriptContents.dispatch?.includes(needle)),
  "contraintes attendues dans le payload"
);
addCheck(
  "Mistral API uniquement sur option explicite",
  scriptContents.mistral?.includes("useApi = Boolean(args.api || args.send)") && scriptContents.mistral?.includes("callMistral") && scriptContents.mistral?.includes("Mistral reste sous-agent d'analyse"),
  "--api requis + analyse-only"
);
addCheck(
  "Qwen API uniquement sur option explicite",
  scriptContents.qwen?.includes("useApi = Boolean(args.api || args.send)") && scriptContents.qwen?.includes("callQwen") && scriptContents.qwen?.includes("Qwen/Alibaba reste sous-agent d'analyse"),
  "--api requis + analyse-only"
);

const schema = await safeRead(schemaPath);
addCheck("Schema subagent existe", existsSync(schemaPath), schemaPath);
addCheck(
  "Schema impose dry-run/analysis-only",
  schema.includes('"dry-run"') && schema.includes('"analysis-only"'),
  "mode enumere"
);
addCheck(
  "Schema formalise les contraintes",
  ["constraints", "noSecrets", "noDirectWrite", "noApiCallWithoutExplicitApproval"].every((needle) => schema.includes(needle)),
  "contraintes schema"
);

const statusCounts = checks.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});
const globalStatus = checks.some((item) => item.status === "FAIL")
  ? "FAIL"
  : checks.some((item) => item.status === "WARN")
    ? "WARN"
    : "OK";

const report = await writeReport(
  "subagents",
  "subagent-safety-check",
  `# Controle securite subagents

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Env inspecte: noms de variables seulement, aucune valeur lue dans le rapport.
- Execution externe: non.

## Synthese
${markdownTable(["Statut", "Nombre"], Object.entries(statusCounts))}

## Details
${markdownTable(["Controle", "Statut", "Preuve"], checks.map((item) => [item.label, item.status, item.evidence]))}
`,
  { generatedAt: nowIso(), globalStatus, statusCounts, checks }
);

console.log(`Controle subagents: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);

if (globalStatus === "FAIL") process.exit(1);

async function readEnvNames(path) {
  const content = await safeRead(path);
  const names = new Set();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const name = line.slice(0, index).trim().replace(/^export\s+/, "");
    if (name) names.add(name);
  }
  return names;
}

async function safeRead(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function findPatterns(content, patterns) {
  const lower = content.toLowerCase();
  return patterns.filter((pattern) => lower.includes(pattern.toLowerCase()));
}

function addCheck(label, condition, evidence) {
  checks.push({
    label,
    status: condition === true ? "OK" : condition === "WARN" ? "WARN" : "FAIL",
    evidence: String(evidence || "")
  });
}
