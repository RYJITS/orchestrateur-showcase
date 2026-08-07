import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  isTextLike,
  loadRegistry,
  orchestratorRoot as defaultOrchestratorRoot,
  readJson,
  toPosixPath
} from "../scripts/lib/orchestrator-utils.mjs";
import {
  alignedMarkdownTable,
  automationPaths,
  limitText,
  nowIso,
  parseAutomationArgs,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { orchestratorRoot, resultsRoot } = automationPaths(import.meta.url);
const args = parseAutomationArgs();
const shouldRun = Boolean(args.run);
const githubRules = await readJson(join(orchestratorRoot, "config", "github.rules.json"), {});
const securityRules = await readJson(join(orchestratorRoot, "config", "security.rules.json"), {});

const auditEngines = [
  {
    id: "security",
    label: "Securite",
    script: "scripts/audit-project-security.mjs",
    nextAction: "03-audit-securite",
    purpose: "Detecter secrets, sessions et fichiers sensibles."
  },
  {
    id: "optimization",
    label: "Optimisation",
    script: "scripts/audit-project-optimization.mjs",
    nextAction: "future-action",
    purpose: "Identifier dette, recommandations et ameliorations."
  },
  {
    id: "cleanup",
    label: "Nettoyage",
    script: "scripts/audit-project-cleanup.mjs",
    nextAction: "future-action",
    purpose: "Lister les candidats a archiver sans suppression directe."
  },
  {
    id: "architecture",
    label: "Architecture",
    script: "scripts/audit-project-architecture.mjs",
    nextAction: "future-action",
    purpose: "Lire la structure, les entrees et les risques projet."
  },
  {
    id: "functionality",
    label: "Fonctionnement",
    script: "scripts/verify-project-functionality.mjs",
    nextAction: "future-action",
    purpose: "Verifier build, scripts et fonctionnement local."
  }
];

const results = [];

for (const engine of auditEngines) {
  const scriptPath = join(orchestratorRoot, engine.script);
  if (!shouldRun) {
    results.push({
      ...engine,
      scriptPath,
      status: existsSync(scriptPath) ? "DRY_RUN" : "MANQUE",
      exitCode: null,
      durationMs: 0,
      output: existsSync(scriptPath) ? `node --check ${engine.script}` : "script introuvable"
    });
    continue;
  }
  results.push(await checkEngine(engine, scriptPath));
}

const githubGitOnly = await buildGithubGitOnlySummary();
const hostingerVite = await buildHostingerViteSummary();
const counts = {
  total: results.length,
  present: results.filter((item) => item.status !== "MANQUE").length,
  ok: results.filter((item) => item.status === "OK").length,
  failed: results.filter((item) => item.status === "FAIL").length,
  missing: results.filter((item) => item.status === "MANQUE").length
};
const globalStatus = !shouldRun
  ? "DRY_RUN"
  : counts.failed || counts.missing
    ? "FAIL"
    : githubGitOnly.counts.blocked > 0 || hostingerVite.counts.blocked > 0
      ? "WARN_PUBLICATION"
      : githubGitOnly.counts.review > 0 || githubGitOnly.counts.noGit > 0 || hostingerVite.counts.review > 0 || hostingerVite.counts.needsBuild > 0
        ? "WARN_PUBLICATION"
    : "OK";

const report = await writeAutomationReport(
  resultsRoot,
  "02-moteur-audit",
  `# Automatisation 02 - Moteur audit

- Date: ${nowIso()}
- Mode: ${shouldRun ? "RUN" : "DRY_RUN"}
- Statut global: **${globalStatus}**
- Racine orchestrateur: \`${orchestratorRoot}\`

## Resultat lisible

${alignedMarkdownTable(
  ["Controle", "Resultat"],
  [
    ["Moteurs declares", counts.total],
    ["Moteurs presents", `${counts.present}/${counts.total}`],
    ["Moteurs valides", shouldRun ? counts.ok : "-"],
    ["Moteurs en erreur", shouldRun ? counts.failed : "-"],
    ["Moteurs manquants", counts.missing],
    ["GitHub git-only OK public", githubGitOnly.counts.okPublic],
    ["GitHub git-only OK prive", githubGitOnly.counts.okPrivate],
    ["GitHub git-only a revoir", githubGitOnly.counts.review],
    ["GitHub git-only bloques", githubGitOnly.counts.blocked],
    ["GitHub git-only sans Git", githubGitOnly.counts.noGit],
    ["Hostinger Vite OK", hostingerVite.counts.ok],
    ["Hostinger Vite a revoir", hostingerVite.counts.review],
    ["Hostinger Vite build manquant", hostingerVite.counts.needsBuild],
    ["Hostinger Vite bloque", hostingerVite.counts.blocked],
    ["Projets non Vite", hostingerVite.counts.notVite]
  ]
)}

## Moteurs disponibles

${alignedMarkdownTable(
  ["Moteur", "Statut", "Script", "Action", "Role"],
  results.map((item) => [
    item.label,
    item.status,
    item.script,
    item.nextAction,
    item.purpose
  ])
)}

## Decision publication

Lecture rapide: Hostinger controle le build Vite publie, GitHub controle les fichiers suivis par Git.

${alignedMarkdownTable(
  ["Projet", "Hostinger Vite", "GitHub git-only", "Decision"],
  publicationDecisionRows(hostingerVite.rows, githubGitOnly.rows)
)}

## Controle Hostinger Vite

Principe: pour Hostinger avec Vite, on controle le dossier publie ('dist' par defaut). Les fichiers locaux hors build ne sont pas envoyes si on publie uniquement ce build.

${alignedMarkdownTable(
  ["Projet", "Statut", "Build", "Fichiers", "Blocages", "Alertes"],
  hostingerVite.rows.map((item) => [
    item.project,
    item.status,
    item.buildDir,
    item.fileCount,
    item.blockers,
    item.warnings
  ])
)}

## Controle GitHub git-only

Principe: pour GitHub, on controle les fichiers suivis par Git et l'historique Git. Les fichiers locaux ignores ou non suivis ne sont pas publies par un push GitHub.

${alignedMarkdownTable(
  ["Projet", "Statut", "Suivis", "Gitignore", "Historique", "Blocages", "Alertes"],
  githubGitOnly.rows.map((item) => [
    item.project,
    item.status,
    item.trackedCount,
    item.gitignore,
    item.history,
    item.blockers,
    item.warnings
  ])
)}

## Etapes

${alignedMarkdownTable(
  ["Moteur", "Commande", "Duree", "Sortie"],
  results.map((item) => [
    item.label,
    shouldRun ? `node --check ${item.script}` : item.output,
    item.durationMs ? `${item.durationMs} ms` : "-",
    trim(item.output)
  ])
)}

## Suite conseillee

${globalStatus === "FAIL"
  ? "- Corriger les moteurs manquants ou en erreur avant de lancer les audits specialises."
  : hostingerVite.counts.blocked > 0 || githubGitOnly.counts.blocked > 0
    ? "- Corriger les blocages Hostinger Vite ou GitHub avant publication."
    : hostingerVite.counts.needsBuild > 0 || hostingerVite.counts.review > 0 || githubGitOnly.counts.review > 0
      ? "- Construire les builds Vite manquants et verifier les projets en revue avant publication."
      : "- Passer a l'action 03: audit securite."}
`,
  {
    generatedAt: nowIso(),
    action: "02-moteur-audit",
    mode: shouldRun ? "RUN" : "DRY_RUN",
    globalStatus,
    counts,
    results,
    githubGitOnly,
    hostingerVite
  }
);

console.log(`Automatisation 02: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (shouldRun && globalStatus === "FAIL") process.exitCode = 1;

function checkEngine(engine, scriptPath) {
  if (!existsSync(scriptPath)) {
    return {
      ...engine,
      scriptPath,
      status: "MANQUE",
      exitCode: null,
      durationMs: 0,
      output: "script introuvable"
    };
  }
  const started = Date.now();
  return new Promise((resolvePromise) => {
    execFile(process.execPath, ["--check", scriptPath], {
      cwd: orchestratorRoot,
      windowsHide: true,
      timeout: 60 * 1000,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout = "", stderr = "") => {
      const exitCode = error?.code ?? 0;
      resolvePromise({
        ...engine,
        scriptPath,
        status: exitCode === 0 ? "OK" : "FAIL",
        exitCode,
        durationMs: Date.now() - started,
        output: stdout || stderr || "syntax ok"
      });
    });
  });
}

async function buildGithubGitOnlySummary() {
  const registry = await loadRegistry();
  const projects = (registry.projects || []).filter((project) => !isArchiveProject(project));
  const rows = [];
  const details = [];

  for (const project of projects) {
    const result = await validateGithubGitOnly(project);
    details.push(result);
    rows.push({
      project: project.name,
      status: result.status,
      trackedCount: result.trackedCount,
      gitignore: result.gitignoreStatus,
      history: result.historyStatus,
      blockers: result.blockers.slice(0, 3).join("; ") || "-",
      warnings: result.warnings.slice(0, 3).join("; ") || "-"
    });
  }

  return {
    generatedAt: nowIso(),
    counts: {
      total: details.length,
      okPublic: details.filter((item) => item.status === "OK_GITHUB_PUBLIC").length,
      okPrivate: details.filter((item) => item.status === "OK_GITHUB_PRIVATE").length,
      review: details.filter((item) => item.status === "REVIEW_GITHUB_DATA").length,
      blocked: details.filter((item) => item.status.startsWith("BLOCKED_GITHUB")).length,
      noGit: details.filter((item) => item.status === "NO_GIT").length
    },
    rows,
    details
  };
}

async function buildHostingerViteSummary() {
  const registry = await loadRegistry();
  const projects = (registry.projects || []).filter((project) => !isArchiveProject(project));
  const rows = [];
  const details = [];

  for (const project of projects) {
    const result = await validateHostingerVite(project);
    details.push(result);
    rows.push({
      project: project.name,
      status: result.status,
      buildDir: result.buildDir || "-",
      fileCount: result.fileCount,
      blockers: result.blockers.slice(0, 3).join("; ") || "-",
      warnings: result.warnings.slice(0, 3).join("; ") || "-"
    });
  }

  return {
    generatedAt: nowIso(),
    counts: {
      total: details.length,
      ok: details.filter((item) => item.status === "OK_HOSTINGER_VITE").length,
      review: details.filter((item) => item.status === "REVIEW_HOSTINGER_VITE").length,
      needsBuild: details.filter((item) => item.status === "NEEDS_VITE_BUILD").length,
      blocked: details.filter((item) => item.status === "BLOCKED_HOSTINGER_VITE").length,
      notVite: details.filter((item) => item.status === "NON_VITE").length
    },
    rows,
    details
  };
}

async function validateHostingerVite(project) {
  const vite = await detectViteProject(project.path);
  if (!vite) {
    return {
      id: project.id,
      project: project.name,
      status: "NON_VITE",
      buildDir: "",
      fileCount: 0,
      blockers: [],
      warnings: ["projet-non-vite"],
      findings: []
    };
  }

  const buildDir = await findBuildDir(project.path);
  if (!buildDir) {
    return {
      id: project.id,
      project: project.name,
      status: "NEEDS_VITE_BUILD",
      buildDir: "dist",
      fileCount: 0,
      blockers: [],
      warnings: ["build-vite-absent"],
      findings: []
    };
  }

  const inspection = await inspectHostingerBuild(buildDir.absolutePath);
  const status = inspection.blockers.length
    ? "BLOCKED_HOSTINGER_VITE"
    : inspection.warnings.length
      ? "REVIEW_HOSTINGER_VITE"
      : "OK_HOSTINGER_VITE";

  return {
    id: project.id,
    project: project.name,
    status,
    buildDir: buildDir.relativePath,
    fileCount: inspection.fileCount,
    blockers: inspection.blockers,
    warnings: inspection.warnings,
    findings: inspection.findings
  };
}

async function detectViteProject(projectPath) {
  const packageJson = await readJson(join(projectPath, "package.json"), null);
  const deps = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {})
  };
  const scripts = Object.values(packageJson?.scripts || {}).join(" ");
  return Boolean(
    deps.vite
    || /\bvite\b/i.test(scripts)
    || existsSync(join(projectPath, "vite.config.js"))
    || existsSync(join(projectPath, "vite.config.mjs"))
    || existsSync(join(projectPath, "vite.config.ts"))
  );
}

async function findBuildDir(projectPath) {
  const candidates = ["dist", "build"];
  for (const candidate of candidates) {
    const absolutePath = join(projectPath, candidate);
    const info = await stat(absolutePath).catch(() => null);
    if (info?.isDirectory()) return { absolutePath, relativePath: candidate };
  }
  return null;
}

async function inspectHostingerBuild(buildDir) {
  const files = await walkPublishFiles(buildDir, 7000);
  const blockers = [];
  const warnings = [];
  const findings = [];
  const hasIndex = files.items.some((item) => toPosixPath(item.relativePath).toLowerCase() === "index.html");

  if (!hasIndex) warnings.push("index.html-manquant");
  if (files.truncated) warnings.push("scan-build-tronque");

  for (const item of files.items) {
    if (isBlockedHostingerPath(item.relativePath)) {
      blockers.push(`fichier-interdit:${limitText(item.relativePath, 50)}`);
      findings.push({ severity: "blocker", type: "blocked-path", path: item.relativePath });
    }
    if (isReviewPath(item.relativePath)) {
      warnings.push(`fichier-a-verifier:${limitText(item.relativePath, 50)}`);
      findings.push({ severity: "review", type: "review-file", path: item.relativePath });
    }
    if (!isTextLike(item.absolutePath, item.size)) continue;
    const text = await readFile(item.absolutePath, "utf8").catch(() => "");
    const secret = detectSecret(text);
    if (secret?.severity === "blocker") {
      blockers.push(`${secret.type}:${limitText(item.relativePath, 50)}`);
      findings.push({ severity: "blocker", type: secret.type, path: item.relativePath });
    }
    if (secret?.severity === "review") {
      warnings.push(`${secret.type}:${limitText(item.relativePath, 50)}`);
      findings.push({ severity: "review", type: secret.type, path: item.relativePath });
    }
  }

  return {
    fileCount: files.items.length,
    blockers: [...new Set(blockers)].slice(0, 12),
    warnings: [...new Set(warnings)].slice(0, 12),
    findings
  };
}

async function walkPublishFiles(root, maxFiles) {
  const items = [];
  let truncated = false;

  async function visit(folder) {
    if (items.length >= maxFiles) {
      truncated = true;
      return;
    }
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (items.length >= maxFiles) {
        truncated = true;
        return;
      }
      const absolutePath = join(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolutePath).catch(() => null);
      items.push({
        absolutePath,
        relativePath: toPosixPath(absolutePath.slice(root.length + 1)),
        size: info?.size || 0
      });
    }
  }

  await visit(root);
  return { items, truncated };
}

function isBlockedHostingerPath(filePath) {
  const normalized = toPosixPath(filePath).toLowerCase();
  const base = basename(normalized);
  const ext = extname(normalized);
  const blockedNames = [".env", ".env.local", "env.local", "env.local"];
  const blockedExtensions = [".pem", ".key", ".p12", ".pfx"];
  const blockedFragments = [
    "session/",
    "sessions/",
    "baileys-auth/",
    ".whatsapp-web-profile/",
    ".whatsapp-web-chrome-profile/",
    "cookies"
  ];
  return blockedNames.includes(base)
    || blockedExtensions.includes(ext)
    || blockedFragments.some((fragment) => normalized.includes(fragment));
}

function publicationDecisionRows(hostRows, githubRows) {
  const githubByProject = new Map(githubRows.map((row) => [row.project, row]));
  return hostRows.map((host) => {
    const github = githubByProject.get(host.project) || { status: "INCONNU" };
    return [
      host.project,
      host.status,
      github.status,
      publicationDecision(host.status, github.status)
    ];
  });
}

function publicationDecision(hostingerStatus, githubStatus) {
  if (hostingerStatus === "OK_HOSTINGER_VITE" && githubStatus === "OK_GITHUB_PUBLIC") return "Hostinger OK + GitHub public OK";
  if (hostingerStatus === "OK_HOSTINGER_VITE" && githubStatus === "OK_GITHUB_PRIVATE") return "Hostinger OK + GitHub prive OK";
  if (hostingerStatus === "OK_HOSTINGER_VITE") return "Hostinger possible, GitHub a traiter";
  if (hostingerStatus === "NEEDS_VITE_BUILD") return "Lancer build Vite avant Hostinger";
  if (hostingerStatus === "BLOCKED_HOSTINGER_VITE") return "Bloque Hostinger";
  if (hostingerStatus === "REVIEW_HOSTINGER_VITE") return "Verifier build Vite";
  if (githubStatus.startsWith("BLOCKED_GITHUB")) return "GitHub bloque";
  if (githubStatus === "NO_GIT") return "GitHub impossible sans Git";
  return "Pas de decision publication";
}

async function validateGithubGitOnly(project) {
  if (!existsSync(join(project.path, ".git"))) {
    return {
      id: project.id,
      project: project.name,
      status: "NO_GIT",
      trackedCount: 0,
      gitignoreStatus: "MANQUE",
      historyStatus: "NO_GIT",
      blockers: ["git-local-absent"],
      warnings: [],
      trackedFindings: [],
      historyFindings: [],
      gitignoreMissing: []
    };
  }

  const trackedFiles = await gitList(project.path, ["ls-files", "-z"]);
  const historyFiles = await gitHistoryFiles(project.path);
  const gitignore = await inspectGitignore(project.path);
  const trackedFindings = await inspectTrackedFiles(project.path, trackedFiles);
  const historyFindings = historyFiles.filter((file) => isBlockedPath(file));
  const blockers = [];
  const warnings = [];

  if (!trackedFiles.length) warnings.push("aucun-fichier-suivi-par-git");
  if (trackedFindings.blockers.length) blockers.push(`fichiers-suivis-sensibles:${shortList(trackedFindings.blockers)}`);
  if (trackedFindings.secretBlockers.length) blockers.push(`secrets-suivis:${shortList(trackedFindings.secretBlockers)}`);
  if (historyFindings.length) blockers.push(`historique-sensible:${shortList(historyFindings)}`);
  if (!gitignore.exists) warnings.push(".gitignore-manquant");
  if (gitignore.missing.length) warnings.push(`gitignore-incomplet:${gitignore.missing.join(",")}`);
  if (trackedFindings.reviews.length) warnings.push(`donnees-a-verifier:${shortList(trackedFindings.reviews)}`);
  if (trackedFindings.secretReviews.length) warnings.push(`secrets-possibles:${shortList(trackedFindings.secretReviews)}`);
  if (project.git?.dirty) warnings.push("git-avec-changements-locaux");

  const status = statusForGithub(project, blockers, warnings);
  return {
    id: project.id,
    project: project.name,
    path: project.path,
    status,
    trackedCount: trackedFiles.length,
    gitignoreStatus: gitignore.exists
      ? gitignore.missing.length ? `A_COMPLETER:${gitignore.missing.join(",")}` : "OK"
      : "MANQUE",
    historyStatus: historyFindings.length ? "BLOQUE" : historyFiles.length ? "OK" : "NO_COMMITS",
    blockers,
    warnings,
    trackedFindings,
    historyFindings,
    gitignoreMissing: gitignore.missing
  };
}

function statusForGithub(project, blockers, warnings) {
  if (blockers.some((item) => item.startsWith("historique-sensible"))) return "BLOCKED_GITHUB_HISTORY";
  if (blockers.length) return "BLOCKED_GITHUB_SECRETS";
  if (warnings.length) return "REVIEW_GITHUB_DATA";
  if (["PRIVATE_INTERNAL", "ARCHIVE_ONLY"].includes(project.publicationStatus) || project.status === "PRIVATE_INTERNAL") {
    return "OK_GITHUB_PRIVATE";
  }
  return "OK_GITHUB_PUBLIC";
}

async function inspectGitignore(projectPath) {
  const file = join(projectPath, ".gitignore");
  if (!existsSync(file)) return { exists: false, missing: requiredGitignoreGroups().map((group) => group.label) };
  const content = await readFile(file, "utf8").catch(() => "");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const missing = requiredGitignoreGroups()
    .filter((group) => !group.patterns.some((pattern) => gitignoreHas(lines, pattern)))
    .map((group) => group.label);
  return { exists: true, missing };
}

function requiredGitignoreGroups() {
  return githubRules.gitOnlyPublication?.requiredGitignoreGroups || [
    { label: "env", patterns: [".env", ".env*", ".env.local"] },
    { label: "node_modules", patterns: ["node_modules", "node_modules/"] },
    { label: "sessions", patterns: ["session", "sessions", "baileys-auth"] },
    { label: "logs", patterns: ["*.log", "logs", "logs/"] },
    { label: "private-keys", patterns: ["*.pem", "*.key", "*.p12", "*.pfx"] }
  ];
}

function gitignoreHas(lines, pattern) {
  const wanted = String(pattern || "").toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
  return lines.some((line) => {
    const normalized = line.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
    return normalized === wanted || normalized.includes(wanted);
  });
}

async function inspectTrackedFiles(projectPath, trackedFiles) {
  const blockers = [];
  const reviews = [];
  const secretBlockers = [];
  const secretReviews = [];

  for (const file of trackedFiles) {
    if (isBlockedPath(file)) blockers.push(file);
    if (isReviewPath(file)) reviews.push(file);

    const absolutePath = join(projectPath, file);
    const info = await stat(absolutePath).catch(() => null);
    if (!info || !info.isFile() || !isTextLike(absolutePath, info.size)) continue;
    const text = await readFile(absolutePath, "utf8").catch(() => "");
    const secret = detectSecret(text);
    if (secret?.severity === "blocker") secretBlockers.push(`${secret.type}:${file}`);
    if (secret?.severity === "review") secretReviews.push(`${secret.type}:${file}`);
  }

  return { blockers, reviews, secretBlockers, secretReviews };
}

function detectSecret(text) {
  const patterns = [
    { type: "openai-key", severity: "blocker", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { type: "github-token", severity: "blocker", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
    { type: "private-key", severity: "blocker", regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i },
    { type: "bearer-token", severity: "blocker", regex: /\bbearer\s+[A-Za-z0-9._-]{24,}/i },
    {
      type: "possible-secret-assignment",
      severity: "review",
      regex: /\b(api[_-]?key|token|secret|password|private[_-]?key|bearer)\b\s*[:=]\s*(?![A-Za-z_][A-Za-z0-9_]*\s*\()(?!(?:process\.env|import\.meta\.env|fileEnv|env|Deno\.env|os\.environ)\b)['"]?[A-Za-z0-9_./+=-]{12,}/i
    },
    {
      type: "vite-public-secret-name",
      severity: "review",
      regex: /\bVITE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\b\s*[:=]/i
    }
  ];
  return patterns.find((pattern) => pattern.regex.test(text)) || null;
}

function isBlockedPath(filePath) {
  const normalized = toPosixPath(filePath).toLowerCase();
  const base = basename(normalized);
  const ext = extname(normalized);
  if (base === ".env.example") return false;
  const blockedNames = [
    ...(securityRules.blockedFileNames || []),
    ".env",
    ".env.local"
  ].map((item) => String(item).toLowerCase());
  const blockedExtensions = githubRules.gitOnlyPublication?.blockedExtensions || securityRules.publicBlockedExtensions || [".pem", ".key", ".p12", ".pfx"];
  const fragments = githubRules.gitOnlyPublication?.blockedPathFragments || securityRules.blockedDirectoryFragments || [];
  return blockedNames.includes(base)
    || blockedExtensions.includes(ext)
    || fragments.some((fragment) => normalized.includes(String(fragment).toLowerCase()));
}

function isReviewPath(filePath) {
  const ext = extname(String(filePath).toLowerCase());
  const reviewExtensions = githubRules.gitOnlyPublication?.reviewExtensions || [".xlsx", ".xls", ".csv", ".sqlite", ".db", ".zip", ".7z", ".rar"];
  return reviewExtensions.includes(ext);
}

async function gitList(projectPath, args) {
  try {
    const output = await execGit(projectPath, args);
    return output.split("\0").map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function gitHistoryFiles(projectPath) {
  try {
    const output = await execGit(projectPath, ["log", "--all", "--name-only", "--pretty=format:"]);
    return [...new Set(output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function execGit(projectPath, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("git", ["-C", projectPath, ...args], {
      cwd: defaultOrchestratorRoot,
      windowsHide: true,
      timeout: 60 * 1000,
      maxBuffer: 20 * 1024 * 1024
    }, (error, stdout = "", stderr = "") => {
      if (error) {
        error.stderr = stderr;
        rejectPromise(error);
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function isArchiveProject(project) {
  return project.id === "99-archive" || project.name === "99_Archive" || project.category === "archive";
}

function shortList(items, limit = 2) {
  const list = items.slice(0, limit).map((item) => limitText(item, 48));
  const suffix = items.length > limit ? ` +${items.length - limit}` : "";
  return `${list.join(", ")}${suffix}`;
}

function trim(value) {
  return trimText(value, 180);
}
