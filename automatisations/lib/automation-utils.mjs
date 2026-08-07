import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureDir,
  nowIso,
  readJson,
  stamp,
  writeJson,
  writeText
} from "../../scripts/lib/orchestrator-utils.mjs";

export { nowIso };

export function automationPaths(metaUrl) {
  const scriptDir = dirname(fileURLToPath(metaUrl));
  const automatisationsRoot = scriptDir.endsWith(`${join("automatisations", "lib")}`)
    ? resolve(scriptDir, "..")
    : scriptDir;
  const orchestratorRoot = resolve(automatisationsRoot, "..");
  const resultsRoot = join(automatisationsRoot, "99_Resultats");
  return { automatisationsRoot, orchestratorRoot, resultsRoot };
}

export function parseAutomationArgs(argv = process.argv.slice(2)) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }
    const [rawKey, rawValue] = item.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (rawValue !== undefined) {
      parsed[key] = rawValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  if (parsed.dryRun) parsed.run = false;
  return parsed;
}

export async function writeAutomationReport(resultsRoot, baseName, markdown, jsonData) {
  const actionResultsRoot = join(resultsRoot, baseName);
  await ensureDir(actionResultsRoot);
  const dateStamp = stamp();
  const mdPath = join(actionResultsRoot, `${dateStamp}-${baseName}.md`);
  const jsonPath = join(actionResultsRoot, `${dateStamp}-${baseName}.json`);
  await writeText(mdPath, markdown);
  await writeJson(jsonPath, jsonData);
  return { mdPath, jsonPath };
}

export async function latestJsonReport(resultsRoot, baseName, predicate = () => true) {
  const folder = join(resultsRoot, baseName);
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = join(folder, entry.name);
    const info = await stat(file).catch(() => null);
    files.push({ file, mtime: info?.mtime?.getTime?.() || 0 });
  }
  files.sort((a, b) => b.mtime - a.mtime);

  for (const item of files) {
    const data = await readJson(item.file, null);
    if (data && predicate(data)) return { path: item.file, data };
  }
  return null;
}

export function alignedMarkdownTable(headers, rows) {
  const cleanHeaders = headers.map(tableCell);
  const cleanRows = rows.map((row) => cleanHeaders.map((_, index) => tableCell(row[index])));
  const widths = cleanHeaders.map((header, index) => Math.max(
    3,
    header.length,
    ...cleanRows.map((row) => row[index].length)
  ));
  const renderRow = (row) => `| ${row.map((cell, index) => cell.padEnd(widths[index], " ")).join(" | ")} |`;
  const separator = widths.map((width) => "-".repeat(width));
  return [
    renderRow(cleanHeaders),
    renderRow(separator),
    ...cleanRows.map(renderRow)
  ].join("\n");
}

export function commandText(stepOrCommand) {
  if (stepOrCommand?.displayCommand) return stepOrCommand.displayCommand;
  const commandSpec = Array.isArray(stepOrCommand) ? stepOrCommand : stepOrCommand.command;
  const [command, commandArgs] = commandSpec;
  return [command, ...commandArgs].join(" ");
}

export function limitText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function trimText(value, maxLength = 180) {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength) || "-";
}

function tableCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}
