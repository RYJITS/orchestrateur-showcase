import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadRegistry,
  readJson
} from "../scripts/lib/orchestrator-utils.mjs";
import {
  alignedMarkdownTable,
  automationPaths,
  latestJsonReport,
  nowIso,
  parseAutomationArgs,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { orchestratorRoot, resultsRoot } = automationPaths(import.meta.url);
const args = parseAutomationArgs();
const shouldRun = Boolean(args.run);
const publishRequested = Boolean(args.publish || args.deploy || args.hostingerPublish);
const hostingerRules = await readJson(join(orchestratorRoot, "config", "hostinger.rules.json"), {});
const registry = await loadRegistry();
const domain = String(args.domain || hostingerRules.siteMaMethodeDomain || "cv.c2rdesign.com").trim();
const siteProject = (registry.projects || []).find((project) => project.name === "01_SITE_MA_METHODE" || project.id === "01-site-ma-methode");

const checks = [];
let preparation = null;

checks.push(await runScript("hostinger:check Site Ma Methode", "validate-hostinger-gates.mjs", ["--project", "01-site-ma-methode"]));

if (shouldRun && checks.every((item) => item.exitCode === 0)) {
  preparation = await runScript("preparer archive Site Ma Methode", "publish-site-ma-methode.mjs", ["--domain", domain]);
}

const latestPublication = shouldRun && preparation?.exitCode === 0
  ? await latestHostingerPublicationReport()
  : null;
const archivePath = latestPublication?.data?.archivePath || archiveFromOutput(preparation?.output) || "";
const mcpReady = Boolean(archivePath && existsSync(archivePath));
const hasFailure = checks.some((item) => item.exitCode !== 0) || (preparation && preparation.exitCode !== 0);
const globalStatus = hasFailure
  ? "FAIL"
  : !shouldRun
    ? "DRY_RUN"
    : mcpReady
      ? (publishRequested ? "READY_MCP_HOSTINGER" : "ARCHIVE_HOSTINGER_PRETE")
      : "A_COMPLETER";

const report = await writeAutomationReport(
  resultsRoot,
  "08-publication-hostinger",
  `# Automatisation 08 - Publication Hostinger

- Date: ${nowIso()}
- Mode: ${shouldRun ? "RUN" : "DRY_RUN"}
- Publication reelle demandee: ${publishRequested ? "oui" : "non"}
- Statut global: **${globalStatus}**
- Domaine cible: \`${domain || "-"}\`
- Projet publie: Site Ma Methode
- Publication reelle locale: non
- Outil obligatoire: MCP Hostinger \`hosting_deployStaticWebsite\`

## Resultat lisible

${alignedMarkdownTable(
  ["Controle", "Resultat"],
  [
    ["Projet Site Ma Methode", siteProject?.name || "MANQUE"],
    ["Securite site", siteProject?.securityStatus || "UNKNOWN"],
    ["Fonctionnement site", siteProject?.functionalityStatus || "UNKNOWN"],
    ["Domaine", domain || "-"],
    ["Archive preparee", archivePath || "-"],
    ["Archive existe", archivePath ? (existsSync(archivePath) ? "oui" : "non") : "-"],
    ["Statut publication", latestPublication?.data?.status || globalStatus],
    ["Action MCP", mcpReady ? "prete" : "non prete"]
  ]
)}

## Etapes

${alignedMarkdownTable(
  ["Etape", "Code", "Duree", "Sortie"],
  [...checks, preparation].filter(Boolean).map((item) => [
    item.label,
    item.exitCode,
    `${item.durationMs} ms`,
    trimText(item.output, 260)
  ])
)}

## Handoff MCP Hostinger

${mcpReady
  ? alignedMarkdownTable(
      ["Champ", "Valeur"],
      [
        ["Tool", "mcp__hostinger_mcp.hosting_deployStaticWebsite"],
        ["Domain", domain],
        ["archivePath", archivePath],
        ["removeArchive", "false"]
      ]
    )
  : "- Archive non prete. Corriger les controles avant publication."}

## Regles

- La tache 08 ne lit aucune cle Hostinger.
- La tache 08 prepare et valide une archive publique du Site Ma Methode.
- La publication reelle doit passer par le MCP Hostinger, jamais par FTP/SFTP/cle locale.
- Si \`--publish\` est demande depuis le lanceur local, le resultat reste \`READY_MCP_HOSTINGER\`: Codex doit ensuite appeler le MCP Hostinger.
`,
  {
    generatedAt: nowIso(),
    action: "08-publication-hostinger",
    mode: shouldRun ? "RUN" : "DRY_RUN",
    publishRequested,
    globalStatus,
    domain,
    siteProject: siteProject ? {
      id: siteProject.id,
      name: siteProject.name,
      path: siteProject.path,
      securityStatus: siteProject.securityStatus,
      functionalityStatus: siteProject.functionalityStatus,
      publicationStatus: siteProject.publicationStatus,
      status: siteProject.status
    } : null,
    archivePath,
    latestPublicationReport: latestPublication?.path || null,
    mcp: mcpReady ? {
      tool: "mcp__hostinger_mcp.hosting_deployStaticWebsite",
      domain,
      archivePath,
      removeArchive: false
    } : null,
    checks,
    preparation
  }
);

console.log(`Automatisation 08: ${globalStatus}`);
console.log(`Domaine: ${domain}`);
if (archivePath) console.log(`Archive: ${archivePath}`);
console.log(`Rapport: ${report.mdPath}`);
if (hasFailure) process.exitCode = 1;

function runScript(label, file, extraArgs) {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    execFile(process.execPath, [join(orchestratorRoot, "scripts", file), ...extraArgs], {
      cwd: orchestratorRoot,
      windowsHide: true,
      timeout: 15 * 60 * 1000,
      maxBuffer: 40 * 1024 * 1024
    }, (error, stdout = "", stderr = "") => {
      resolvePromise({
        label,
        file,
        args: extraArgs,
        exitCode: error?.code ?? 0,
        durationMs: Date.now() - started,
        output: [stdout, stderr].filter(Boolean).join("\n").trim()
      });
    });
  });
}

async function latestHostingerPublicationReport() {
  return latestJsonReport(join(orchestratorRoot, "reports"), "hostinger", (data) =>
    data?.status === "READY_FOR_MCP_HOSTINGER" && Boolean(data?.archivePath)
  ).catch(() => null);
}

function archiveFromOutput(output) {
  const match = String(output || "").match(/Archive:\s*(.+)$/im);
  return match ? match[1].trim() : "";
}
