import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import {
  copyExistingFilesToBackup,
  defaultProjectsRoot,
  execFileText,
  gitStatus,
  loadRegistry,
  parseArgs,
  readJson,
  toPosixPath,
  writeJson,
  writeText
} from "../scripts/lib/orchestrator-utils.mjs";
import {
  contentForProject,
  displayName,
  githubCandidateForProject,
  githubUrlForProject,
  hostingerUrlForProject,
  publicUrlForProject
} from "../scripts/lib/project-content.mjs";
import {
  callMistral,
  callQwen,
  loadSubagentEnv
} from "../scripts/lib/subagent-api-utils.mjs";
import { validateGithubReadmeGuide } from "../scripts/lib/github-readme-guide.mjs";
import {
  buildShowcaseFilePlan,
  sanitizeShowcaseText
} from "../scripts/lib/github-showcase-safety.mjs";
import {
  alignedMarkdownTable,
  automationPaths,
  latestJsonReport,
  limitText,
  nowIso,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { orchestratorRoot, resultsRoot } = automationPaths(import.meta.url);
const args = parseArgs();
const shouldRun = Boolean(args.run);
const useApi = Boolean(args.api || args.ia || args.ai);
const compareAgents = Boolean(args.compareAgents || args.compare || args.both);
const requestedAgent = String(args.agent || "auto").toLowerCase();
const maxProjects = Number(args.limit || 0);
const githubRules = await readJson(join(orchestratorRoot, "config", "github.rules.json"), {});
const generatorRules = {
  ...defaultGeneratorRules(),
  ...(githubRules.publicRepositoryGenerator || {})
};
const sharingRules = {
  ...defaultPrivateAndShowcaseRules(),
  ...(githubRules.privateAndShowcaseRepositoryGenerator || {})
};
const registry = await loadRegistry();
const action02 = await latestJsonReport(resultsRoot, "02-moteur-audit", (data) => Boolean(data?.githubGitOnly)).catch(() => null);
const githubByProject = new Map((action02?.data?.githubGitOnly?.details || []).map((item) => [item.project, item]));
const projects = selectProjects(registry.projects || []);
const preparations = [];
const cleanupResults = [];
const mistralDrafts = [];

for (const project of projects) {
  if (shouldRun && !args.noMistral && !args.noAi) {
    mistralDrafts.push(await ensureMistralProjectContent(project));
  }
  if (shouldRun) cleanupResults.push(await applySafeSecurityCleanup(project));
  preparations.push(await buildPreparation(project));
}

const aiValidation = useApi
  ? await validateWithSubagents(preparations)
  : {
      mode: "not-requested",
      status: "NOT_SENT",
      reason: "Option --api/--ia absente",
      selected: null,
      calls: []
    };

const applied = [];
if (shouldRun) {
  for (const preparation of preparations) {
    applied.push(await applyPreparation(preparation));
  }
}

const counts = statusCounts(preparations);
const executionFailures = applied.some((item) => item.status === "FAIL");
const globalStatus = preparationGlobalStatus(counts, executionFailures);

const report = await writeAutomationReport(
  resultsRoot,
  "04-preparation-git-public",
  `# Automatisation 04 - Preparation Git public

- Date: ${nowIso()}
- Mode: ${shouldRun ? "RUN" : "DRY_RUN"}
- Validation IA: ${useApi ? "oui" : "non"}
- Statut global: **${globalStatus}**
- Source action 02: ${action02?.path ? `\`${action02.path}\`` : "aucun rapport 02 exploitable"}
- Publication / push GitHub: **non**
- Build Vite/Node: ${shouldRun ? "execute si script build detecte" : "verifie en dry-run"}
- Strategie non-public: depot prive interne + vitrine publique nettoyee

## Resultat lisible

${alignedMarkdownTable(
  ["Controle", "Resultat"],
  [
    ["Projets analyses", preparations.length],
    ["Prets GitHub public", counts.READY_GITHUB_PUBLIC || 0],
    ["Prets GitHub prive + vitrine", counts.READY_GITHUB_PRIVATE_SHOWCASE || 0],
    ["A completer / valider", (counts.A_COMPLETER_PUBLIC || 0) + (counts.A_COMPLETER_PRIVATE_SHOWCASE || 0) + (counts.A_INITIALISER_GIT || 0) + (counts.REVUE_GIT_REQUISE || 0) + (counts.A_VALIDER_SECURITE || 0)],
    ["Prives/interne prepares", counts.READY_GITHUB_PRIVATE_SHOWCASE || 0],
    ["Archives exclues", counts.ARCHIVE_EXCLUE || 0],
    ["Bloques securite", counts.BLOQUE_SECURITE || 0],
    ["README installation/utilisation OK", preparations.filter((item) => item.readmeGuideValidation?.status === "OK").length],
    ["README bloques", preparations.filter((item) => item.readmeGuideValidation?.status === "FAIL").length],
    ["Validation Mistral/Qwen", aiValidation.status],
    ["Redactions Mistral projet", shouldRun ? mistralDrafts.filter((item) => item.status === "OK").length : "-"],
    ["Changements Git utiles", sumGitChanges("publicUseful")],
    ["Changements Git internes ignores", sumGitChanges("ignoredLocal")],
    ["Fichiers internes suivis a retirer", sumGitChanges("trackedInternal")],
    ["Sorties hub obsoletes a archiver", sumGitChanges("generatedRetirements")],
    ["Changements Git a revoir", sumGitChanges("reviewRequired")],
    ["Nettoyages securite", shouldRun ? cleanupResults.filter((item) => item.status === "CLEANED").length : "-"],
    ["Fichiers ecrits en RUN", shouldRun ? applied.filter((item) => item.status === "OK").length : "-"],
    ["Builds OK", shouldRun ? applied.filter((item) => item.build?.status === "OK").length : "-"],
    ["Builds en echec", shouldRun ? applied.filter((item) => item.build?.status === "FAIL").length : "-"]
  ]
)}

## Regles du generateur

${renderRules()}

## Decision par projet

${alignedMarkdownTable(
  ["Projet", "Statut 04", "Mode GitHub", "Securite", "GitHub actuel", "Install local", "Manques", "Action prioritaire"],
  preparations.map((item) => [
    item.project.name,
    item.status,
    item.githubSharingMode,
    item.securityStatus,
    item.githubStatus,
    item.localInstall.installCommand || "-",
    item.missingRequiredFiles.join(", ") || "-",
    item.actions[0] || "-"
  ])
)}

## Fichiers utiles par projet

${renderFilesSection(preparations)}

## Nettoyage securite automatique

${renderCleanupSection(cleanupResults)}

## Redaction Mistral projet

${renderMistralDraftSection(mistralDrafts)}

## Validation IA Mistral / Qwen

${renderAiSection(aiValidation)}

## Execution

${shouldRun
  ? alignedMarkdownTable(
      ["Projet", "Statut", "Build", "Details"],
      applied.map((item) => [item.project, item.status, item.build?.status || "-", item.details])
    )
  : "- Dry-run uniquement. Relancer avec \\`--run\\` pour ecrire les fichiers de preparation, verifier/construire Vite et ne rien publier."}

## Interdictions permanentes

- Aucun \`git add .\`.
- Aucun commit automatique.
- Aucun push automatique.
- Aucun changement de visibilite GitHub.
- Aucun depot public complet si l'audit securite n'est pas \`OK_PUBLIC\`; une vitrine assainie reste permise par la politique privee avec \`OK_PRIVATE\`.
`,
  {
    generatedAt: nowIso(),
    action: "04-preparation-git-public",
    mode: shouldRun ? "RUN" : "DRY_RUN",
    globalStatus,
    sourceAction02: action02?.path || null,
    rules: generatorRules,
    sharingRules,
    counts,
    preparations,
    cleanupResults,
    mistralDrafts,
    aiValidation,
    applied
  }
);

console.log(`Automatisation 04: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (shouldRun && applied.some((item) => item.status === "FAIL")) process.exitCode = 1;

function selectProjects(allProjects) {
  const target = args.project ? String(args.project).toLowerCase() : "";
  let selected = allProjects.filter((project) => args.includeArchive || !isArchiveProject(project));
  if (target) {
    selected = selected.filter((project) => {
      const values = [project.id, project.name, project.path].filter(Boolean).map((value) => String(value).toLowerCase());
      return values.some((value) => value.includes(target));
    });
  }
  if (maxProjects > 0) selected = selected.slice(0, maxProjects);
  return selected;
}

async function buildPreparation(project) {
  const content = contentForProject(project);
  const packageJson = await readJson(join(project.path, "package.json"), null);
  const audit = await readJson(join(project.path, "AUDIT_SECURITE.json"), null);
  const git = await gitStatus(project.path);
  const trackedFiles = git.hasGit ? await gitTrackedFiles(project.path) : [];
  const gitChanges = git.hasGit ? await gitChangedFiles(project.path) : [];
  const gitChangePlan = classifyGitChangePlan(gitChanges, trackedFiles);
  const githubDetail = currentGithubDetail(project.name, git, trackedFiles, gitChangePlan);
  const filePlan = await collectRepositoryFiles(project.path);
  const envRefs = await detectEnvReferences(project.path, filePlan.includeCandidates);
  const localInstall = detectLocalInstall(project.path, packageJson);
  const changelogUpdates = await readChangelogUpdates(project.path);
  const securityStatus = audit?.status || project.securityStatus || "UNKNOWN";
  const publicationStatus = project.publicationStatus || project.status || "UNKNOWN";
  const githubSharingMode = githubSharingModeFor(project, securityStatus, publicationStatus);
  const githubScreenshotRequired = ["PUBLIC", "PRIVATE_AND_SHOWCASE"].includes(githubSharingMode) && isLaunchableApplication(project);
  const githubScreenshots = await ensureGithubScreenshots(project, securityStatus);
  const showcaseFilePlan = githubSharingMode === "PRIVATE_AND_SHOWCASE"
    ? await buildShowcaseFilePlan(
        project.path,
        showcaseCandidates(filePlan, githubScreenshots),
        showcaseSafetyOptions(project)
      )
    : null;
  const githubStatus = githubDetail.status;
  const requiredFiles = requiredPublicFiles(envRefs);
  const missingRequiredFiles = requiredFiles.filter((file) => !existsSync(join(project.path, file)));
  if (githubScreenshotRequired && !githubScreenshots.length) missingRequiredFiles.push("docs/github-captures/*.png");
  const blockers = [];
  const warnings = [];
  const actions = [];

  if (isArchiveProject(project)) blockers.push("archive-exclue");
  if (String(securityStatus).startsWith("FAIL")) blockers.push(`securite-${securityStatus}`);
  if (publicationStatus === "ARCHIVE_ONLY") blockers.push("archive-exclue");
  if (!["OK_PUBLIC", "OK_PRIVATE"].includes(securityStatus) && !String(securityStatus).startsWith("FAIL")) warnings.push(`securite-a-valider-${securityStatus}`);
  if (githubStatus.startsWith("BLOCKED_GITHUB")) blockers.push(githubStatus);
  if (!git.hasGit) warnings.push("git-local-absent");
  if (gitChangePlan.publicUseful.length) warnings.push("git-changements-utiles-pour-publication");
  if (gitChangePlan.ignoredLocal.length) warnings.push("git-changements-internes-ignores");
  if (gitChangePlan.trackedInternal.length) warnings.push("git-fichiers-internes-suivis-a-retirer");
  if (gitChangePlan.reviewRequired.length) warnings.push("git-changements-a-revoir");
  if (githubStatus === "REVIEW_GITHUB_DATA") warnings.push("revue-github-data");
  if (filePlan.reviewCandidates.length) warnings.push("fichiers-a-revoir-avant-suivi-git");
  if (showcaseFilePlan?.excludeCandidates.length) warnings.push("vitrine-fichiers-prives-exclus");
  if (missingRequiredFiles.length) warnings.push("fichiers-publics-manquants");
  if (!localInstall.installCommand) warnings.push("installation-locale-non-detectee");

  if (String(securityStatus).startsWith("FAIL")) actions.push("corriger l'audit securite avant publication GitHub");
  if (githubSharingMode === "PRIVATE_AND_SHOWCASE") {
    actions.push("preparer un depot GitHub prive interne sans secrets");
    actions.push("preparer une vitrine GitHub publique nettoyee et installable quand le projet le permet");
    if (showcaseFilePlan?.excludeCandidates.length) {
      actions.push(`exclure ${showcaseFilePlan.excludeCandidates.length} fichier(s) contenant des metadonnees privees de la vitrine publique`);
    }
  }
  if (missingRequiredFiles.includes("README.md")) actions.push("generer README.md public avec concept, installation et captures si application");
  if (missingRequiredFiles.includes("docs/github-captures/*.png")) actions.push("generer au moins une capture publique du projet avant publication GitHub");
  if (missingRequiredFiles.includes(".gitignore")) actions.push("creer/completer .gitignore");
  if (missingRequiredFiles.includes(".env.example")) actions.push("creer .env.example sans valeur secrete");
  if (!localInstall.installCommand) actions.push("documenter la commande d'installation locale");
  if (!git.hasGit) actions.push("initialiser Git automatiquement dans la tache 06 apres validation securite");
  if (gitChangePlan.reviewRequired.length) actions.push("revoir seulement les changements Git non classes avant commit public");
  if (githubStatus === "REVIEW_GITHUB_DATA") actions.push(...githubReviewActions(githubDetail, git));
  if (!actions.length) actions.push("preparation GitHub publique prete pour revue humaine");

  const status = statusForPreparation(project, {
    blockers,
    warnings,
    securityStatus,
    publicationStatus,
    githubSharingMode,
    githubStatus,
    git,
    gitChangePlan,
    filePlan,
    missingRequiredFiles
  });

  const preparation = {
    generatedAt: nowIso(),
    project: {
      id: project.id,
      name: project.name,
      title: content.title || displayName(project.name),
      path: project.path,
      relativePath: toPosixPath(relative(defaultProjectsRoot, project.path)),
      status: project.status,
      publicationStatus,
      publicUrl: publicUrlForProject(project),
      hostingerUrl: hostingerUrlForProject(project),
      githubUrl: githubUrlForProject(project) || githubCandidateForProject(project) || ""
    },
    status,
    githubSharingMode,
    githubRepositories: repositoryPlanFor(project, githubSharingMode),
    securityStatus,
    githubStatus,
    git: {
      hasGit: git.hasGit,
      dirty: git.dirty,
      status: git.status,
      trackedFilesCount: trackedFiles.length,
      changedFilesCount: gitChanges.length
    },
    gitChangePlan,
    localInstall,
    contentSummary: {
      summary: content.summary,
      purpose: content.purpose,
      audience: content.audience || "",
      functions: (content.functions || []).slice(0, 8),
      recentUpdates: unique([...(content.recentUpdates || []), ...changelogUpdates]),
      details: content.details || {},
      stack: project.stack || [],
      package: packageReport(packageJson)
    },
    missingRequiredFiles,
    envReferences: envRefs,
    filePlan,
    showcaseFilePlan,
    githubScreenshotRequired,
    githubScreenshots,
    blockers,
    warnings,
    actions
  };
  applyReadmeGuideValidation(preparation);
  return preparation;
}

async function gitTrackedFiles(projectPath) {
  try {
    const { stdout } = await execFileText("git", ["-C", projectPath, "ls-files"], 10000);
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function gitChangedFiles(projectPath) {
  try {
    const { stdout } = await execFileText("git", ["-C", projectPath, "status", "--porcelain=v1", "-uall"], 10000);
    return stdout.split(/\r?\n/).map(parseGitStatusLine).filter(Boolean);
  } catch {
    return [];
  }
}

function parseGitStatusLine(line) {
  if (!line || line.length < 4) return null;
  const status = line.slice(0, 2);
  let pathText = line.slice(3).trim();
  if (pathText.includes(" -> ")) pathText = pathText.split(" -> ").pop();
  const path = cleanGitPath(pathText);
  if (!path) return null;
  return { status, path };
}

function cleanGitPath(value) {
  let text = String(value || "").trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return toPosixPath(text).replace(/^\.\//, "");
}

function classifyGitChangePlan(changes, trackedFiles) {
  const tracked = new Set(trackedFiles.map((file) => toPosixPath(file)));
  const plan = {
    publicUseful: [],
    ignoredLocal: [],
    trackedInternal: [],
    generatedRetirements: [],
    reviewRequired: []
  };

  for (const change of changes) {
    const path = cleanGitPath(change.path);
    const classInfo = classifyPath(path, path.endsWith("/"), 0);
    const isTracked = tracked.has(path.replace(/\/$/, ""));
    const item = {
      path,
      status: change.status.trim() || change.status,
      reason: classInfo.reason,
      tracked: isTracked
    };

    if (/[RU]/.test(change.status) || change.status.includes("C")) {
      plan.reviewRequired.push({ ...item, reason: "renommage-ou-conflit-a-valider" });
    } else if (classInfo.decision === "exclude") {
      if (isTracked || change.status.includes("D")) {
        plan.trackedInternal.push({ ...item, reason: "fichier-interne-a-retirer-de-l-index-public" });
      } else {
        plan.ignoredLocal.push(item);
      }
    } else if (change.status.includes("D") && isGeneratedHubArtifact(path)) {
      plan.generatedRetirements.push({ ...item, reason: "sortie-hub-generee-obsolete-a-archiver-avant-retrait" });
    } else if (change.status.includes("D")) {
      plan.reviewRequired.push({ ...item, reason: "suppression-a-valider" });
    } else if (classInfo.decision === "review") {
      plan.reviewRequired.push(item);
    } else {
      plan.publicUseful.push(item);
    }
  }

  for (const key of Object.keys(plan)) {
    plan[key].sort((a, b) => a.path.localeCompare(b.path));
  }
  return plan;
}

function currentGithubDetail(projectName, git, trackedFiles, gitChangePlan) {
  const previous = githubByProject.get(projectName) || null;
  if (String(previous?.status || "").startsWith("BLOCKED_GITHUB")) return previous;
  if (!git.hasGit) {
    return { status: "NO_GIT", warnings: ["git-local-absent"], trackedCount: 0 };
  }
  const warnings = [];
  if (!trackedFiles.length && !gitChangePlan.publicUseful.length) warnings.push("aucun-fichier-suivi-par-git");
  if (!trackedFiles.length && gitChangePlan.publicUseful.length) warnings.push("git-fichiers-publics-selectionnes-par-04");
  if (gitChangePlan.reviewRequired.length) warnings.push("git-changements-a-revoir");
  if (gitChangePlan.publicUseful.length) warnings.push("git-changements-utiles-pour-publication");
  if (gitChangePlan.ignoredLocal.length) warnings.push("git-changements-internes-ignores");
  if (gitChangePlan.trackedInternal.length) warnings.push("git-fichiers-internes-suivis-a-retirer");
  return {
    status: (!trackedFiles.length && !gitChangePlan.publicUseful.length) || gitChangePlan.reviewRequired.length ? "REVIEW_GITHUB_DATA" : "OK_GIT_LOCAL",
    warnings,
    trackedCount: trackedFiles.length,
    previousStatus: previous?.status || null
  };
}

function githubReviewActions(githubDetail, git) {
  const warnings = new Set(githubDetail?.warnings || []);
  const actions = [];
  if (warnings.has("aucun-fichier-suivi-par-git")) {
    actions.push("choisir les fichiers publics a suivre dans Git (aucun fichier suivi actuellement)");
  }
  if (warnings.has("git-changements-a-revoir")) {
    actions.push("revoir les changements Git non classes avant commit public");
  }
  return actions;
}

function statusForPreparation(project, context) {
  if (isArchiveProject(project)) return "ARCHIVE_EXCLUE";
  if (String(context.securityStatus).startsWith("FAIL")) return "BLOQUE_SECURITE";
  if (context.githubSharingMode === "PRIVATE_AND_SHOWCASE") {
    if (!isSecurityAllowedForPrivateSharing(context.securityStatus)) return "A_VALIDER_SECURITE";
    if (context.githubStatus.startsWith("BLOCKED_GITHUB")) return "BLOQUE_GITHUB_PRIVATE";
    if (context.filePlan?.truncated) return "A_COMPLETER_PRIVATE_SHOWCASE";
    return "READY_GITHUB_PRIVATE_SHOWCASE";
  }
  if (context.securityStatus !== "OK_PUBLIC") return "A_VALIDER_SECURITE";
  if (context.githubStatus.startsWith("BLOCKED_GITHUB")) return "BLOQUE_GITHUB_PUBLIC";
  if (context.githubStatus === "REVIEW_GITHUB_DATA" || context.gitChangePlan.reviewRequired.length) return "REVUE_GIT_REQUISE";
  if (context.missingRequiredFiles.length) return "A_COMPLETER_PUBLIC";
  return "READY_GITHUB_PUBLIC";
}

function isGeneratedHubArtifact(path) {
  return /^public\/orchestrator\/(?:fiches\/[^/]+\.md|thumbnails\/[^/]+\.(?:jpe?g|png|webp))$/i.test(toPosixPath(path));
}

async function collectRepositoryFiles(projectPath) {
  const includeCandidates = [];
  const excludeCandidates = [];
  const reviewCandidates = [];
  const ignoredDirectories = await ignoredDirectoriesFromGitignore(projectPath);
  let scanned = 0;
  let truncated = false;

  async function visit(folder) {
    if (scanned >= generatorRules.maxScannedFiles) {
      truncated = true;
      return;
    }
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (scanned >= generatorRules.maxScannedFiles) {
        truncated = true;
        return;
      }
      const absolutePath = join(folder, entry.name);
      const relativePath = toPosixPath(relative(projectPath, absolutePath));
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(relativePath.toLowerCase())) {
          excludeCandidates.push({ path: `${relativePath}/`, reason: "dossier-ignore-localement", type: "directory" });
          continue;
        }
        if (existsSync(join(absolutePath, ".git"))) {
          excludeCandidates.push({ path: `${relativePath}/`, reason: "depot-git-imbrique", type: "directory" });
          continue;
        }
        const dirClass = classifyPath(relativePath, true);
        if (dirClass.decision === "exclude") {
          excludeCandidates.push({ path: `${relativePath}/`, reason: dirClass.reason, type: "directory" });
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      scanned += 1;
      const info = await stat(absolutePath).catch(() => null);
      const fileClass = classifyPath(relativePath, false, info?.size || 0);
      const item = {
        path: relativePath,
        size: info?.size || 0,
        reason: fileClass.reason
      };
      if (fileClass.decision === "exclude") excludeCandidates.push(item);
      else if (fileClass.decision === "review") reviewCandidates.push(item);
      else includeCandidates.push(item);
    }
  }

  await visit(projectPath);
  includeCandidates.sort((a, b) => scoreIncludePath(b.path) - scoreIncludePath(a.path) || a.path.localeCompare(b.path));
  return {
    scannedFiles: scanned,
    truncated,
    includeCandidates: includeCandidates.slice(0, generatorRules.maxManifestFiles),
    reviewCandidates: reviewCandidates.slice(0, generatorRules.maxManifestFiles),
    excludeCandidates: excludeCandidates.slice(0, generatorRules.maxManifestFiles)
  };
}

async function ignoredDirectoriesFromGitignore(projectPath) {
  const text = await readFile(join(projectPath, ".gitignore"), "utf8").catch(() => "");
  const directories = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^\//, "");
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const match = line.match(/^([^*?\[\]]+?)\/(?:\*)?$/);
    if (match) directories.add(toPosixPath(match[1]).toLowerCase().replace(/\/$/, ""));
  }
  return directories;
}

function classifyPath(relativePath, isDirectory, size = 0) {
  const normalized = toPosixPath(relativePath).toLowerCase();
  const base = basename(normalized);
  const ext = extname(normalized);
  const blockedDirs = generatorRules.excludeDirectories || [];
  const blockedFragments = generatorRules.excludePathFragments || [];
  const blockedNames = generatorRules.excludeFileNames || [];
  const blockedExtensions = generatorRules.excludeExtensions || [];
  const reviewExtensions = generatorRules.reviewExtensions || [];
  const reviewFragments = generatorRules.reviewPathFragments || [];

  if (blockedDirs.some((dir) => pathIsInsideDirectory(normalized, dir))) {
    return { decision: "exclude", reason: "dossier-genere-ou-prive" };
  }
  if (blockedFragments.some((fragment) => normalized.includes(String(fragment).toLowerCase()))) {
    return { decision: "exclude", reason: "chemin-prive-ou-genere" };
  }
  if (blockedNames.includes(base) && base !== ".env.example") {
    return { decision: "exclude", reason: "fichier-secret-ou-local" };
  }
  if (blockedExtensions.includes(ext)) {
    return { decision: "exclude", reason: "extension-interdite" };
  }
  if (size > generatorRules.maxPublicFileBytes) {
    return { decision: "review", reason: "fichier-volumineux" };
  }
  if (reviewExtensions.includes(ext) || reviewFragments.some((fragment) => normalized.includes(String(fragment).toLowerCase()))) {
    return { decision: "review", reason: "donnee-a-valider-avant-publication" };
  }
  return { decision: "include", reason: scoreIncludePath(relativePath) >= 50 ? "utile-installation-locale" : "source-ou-documentation" };
}

function pathIsInsideDirectory(normalizedPath, directoryName) {
  const dir = String(directoryName || "").toLowerCase().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!dir) return false;
  return normalizedPath === dir
    || normalizedPath.startsWith(`${dir}/`)
    || normalizedPath.includes(`/${dir}/`)
    || normalizedPath.endsWith(`/${dir}`);
}

function scoreIncludePath(relativePath) {
  const normalized = toPosixPath(relativePath).toLowerCase();
  if (["readme.md", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "vite.config.js", "vite.config.ts", "vite.config.mjs"].includes(normalized)) return 100;
  if (["index.html", "tsconfig.json", "jsconfig.json", ".gitignore", ".env.example"].includes(normalized)) return 95;
  if (normalized.startsWith("src/") || normalized.startsWith("app/") || normalized.startsWith("api/")) return 90;
  if (normalized.startsWith("public/") || normalized.startsWith("assets/")) return 80;
  if (normalized.startsWith("docs/") && normalized.endsWith(".md")) return 70;
  if (normalized.endsWith(".md")) return 60;
  if (normalized.startsWith("scripts/")) return 55;
  return 30;
}

async function detectEnvReferences(projectPath, includeCandidates) {
  const refs = new Set();
  const candidates = includeCandidates
    .filter((item) => /\.(?:js|mjs|cjs|ts|tsx|jsx|php|py|md|json|html)$/i.test(item.path))
    .slice(0, 160);
  const patterns = [
    /import\.meta\.env\.([A-Z0-9_]+)/g,
    /process\.env\.([A-Z0-9_]+)/g,
    /getenv\(["']([A-Z0-9_]+)["']\)/g,
    /env\(["']([A-Z0-9_]+)["']\)/g
  ];
  for (const item of candidates) {
    const text = await readSmallText(join(projectPath, item.path), 120000);
    if (!text) continue;
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) refs.add(match[1]);
    }
  }
  return [...refs].filter((name) => !/TOKEN|SECRET|PASSWORD|KEY/i.test(name) || /^VITE_/i.test(name)).slice(0, 30);
}

async function readSmallText(path, maxBytes) {
  const info = await stat(path).catch(() => null);
  if (!info || info.size > maxBytes) return "";
  const buffer = await readFile(path).catch(() => null);
  if (!buffer || buffer.includes(0)) return "";
  return buffer.toString("utf8");
}

async function readChangelogUpdates(projectPath) {
  const text = await readFile(join(projectPath, "CHANGELOG_FR.md"), "utf8").catch(() => "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(isProjectUpdate)
    .slice(0, 12);
}

function isProjectUpdate(value) {
  const normalized = String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!normalized) return false;
  return !/(?:documentation projet|synchronisation de la documentation|registre orchestrateur|audit de securite|validation des audits|verification de securite|statut (?:ok_public|public|fonctionnel)|public_ready|preparation github|publication publique|documentation fonctionnelle|validation[^.]{0,80}publication)/.test(normalized);
}

function requiredPublicFiles(envRefs) {
  const base = generatorRules.requiredPublicFiles || [".gitignore", "README.md"];
  if (envRefs.length && !base.includes(".env.example")) return [...base, ".env.example"];
  return base;
}

function detectLocalInstall(projectPath, packageJson) {
  if (packageJson) {
    const manager = existsSync(join(projectPath, "pnpm-lock.yaml"))
      ? "pnpm"
      : existsSync(join(projectPath, "yarn.lock"))
        ? "yarn"
        : "npm";
    const scripts = packageJson.scripts || {};
    return {
      kind: "node",
      packageManager: manager,
      installCommand: manager === "yarn" ? "yarn install" : `${manager} install`,
      devCommand: scripts.dev ? `${manager} run dev` : scripts.dashboard ? `${manager} run dashboard` : "",
      buildCommand: scripts.build ? `${manager} run build` : "",
      testCommand: scripts.test ? `${manager} test` : "",
      startCommand: scripts.start ? `${manager} run start` : "",
      scripts: Object.keys(scripts).sort()
    };
  }
  if (existsSync(join(projectPath, "requirements.txt"))) {
    return {
      kind: "python",
      packageManager: "pip",
      installCommand: "python -m pip install -r requirements.txt",
      devCommand: "",
      buildCommand: "",
      testCommand: "",
      startCommand: "",
      scripts: []
    };
  }
  if (existsSync(join(projectPath, "index.html"))) {
    return {
      kind: "static-html",
      packageManager: "",
      installCommand: "# Aucune installation requise",
      devCommand: "",
      buildCommand: "",
      testCommand: "",
      startCommand: "Start-Process .\\index.html",
      scripts: ["static-html"]
    };
  }
  return {
    kind: "unknown",
    packageManager: "",
    installCommand: "",
    devCommand: "",
    buildCommand: "",
    testCommand: "",
    startCommand: "",
    scripts: []
  };
}

function packageReport(packageJson) {
  if (!packageJson) {
    return {
      name: "",
      version: "",
      scripts: [],
      dependencies: [],
      devDependencies: []
    };
  }
  return {
    name: packageJson.name || "",
    version: packageJson.version || "",
    scripts: Object.entries(packageJson.scripts || {})
      .map(([name, command]) => `${name}: ${command}`)
      .sort(),
    dependencies: dependencyLines(packageJson.dependencies),
    devDependencies: dependencyLines(packageJson.devDependencies)
  };
}

function dependencyLines(dependencies = {}) {
  return Object.entries(dependencies || {})
    .map(([name, version]) => `${name}${version ? ` ${version}` : ""}`)
    .sort();
}

async function validateWithSubagents(preparations) {
  const envInfo = await loadSubagentEnv();
  const prompt = buildAiPrompt(preparations);
  const system = [
    "Tu es un validateur de preparation GitHub publique.",
    "Tu analyses uniquement le JSON fourni, sans demander de secrets.",
    "Tu dois verifier si les fichiers utiles a une installation locale sont bien prevus.",
    "Tu reponds uniquement en JSON compact, sans Markdown."
  ].join(" ");

  if (compareAgents || requestedAgent === "both") {
    const calls = await Promise.all([
      callAgent("mistral", envInfo.env, prompt, system),
      callAgent("qwen", envInfo.env, prompt, system)
    ]);
    return {
      mode: "compare",
      status: calls.some((call) => call.status === "OK") ? "OK" : "API_ERROR",
      selected: calls.find((call) => call.status === "OK") || null,
      calls
    };
  }

  const order = requestedAgent === "qwen" ? ["qwen", "mistral"] : ["mistral", "qwen"];
  const calls = [];
  for (const agent of order) {
    const call = await callAgent(agent, envInfo.env, prompt, system);
    calls.push(call);
    if (call.status === "OK") {
      return { mode: "fallback", status: "OK", selected: call, calls };
    }
  }
  return { mode: "fallback", status: "API_ERROR", selected: null, calls };
}

async function callAgent(agent, env, prompt, system) {
  const started = Date.now();
  if (String(args.simulateFailAgent || "").toLowerCase() === agent) {
    return {
      agent,
      status: "API_ERROR",
      model: null,
      durationMs: Date.now() - started,
      reason: "Echec simule pour tester le relais IA.",
      parsed: null,
      text: ""
    };
  }
  try {
    const response = agent === "qwen"
      ? await callQwen({ env, prompt, system, maxTokens: 1400, temperature: 0.1, responseFormat: { type: "json_object" } })
      : await callMistral({ env, prompt, system, maxTokens: 1400, temperature: 0.1, responseFormat: { type: "json_object" } });
    const parsed = response.content ? parseAgentJson(response.content) : null;
    return {
      agent,
      status: response.status,
      model: response.model || null,
      durationMs: Date.now() - started,
      reason: response.reason || null,
      parsed,
      text: parsed ? "" : trimText(response.content || "", 1200)
    };
  } catch (error) {
    return {
      agent,
      status: "API_ERROR",
      model: null,
      durationMs: Date.now() - started,
      reason: error.message,
      parsed: null,
      text: ""
    };
  }
}

function buildAiPrompt(preparations) {
  const payload = {
    generatedAt: nowIso(),
    rules: {
      goal: "Preparer un depot public GitHub installable localement, sans secrets ni fichiers locaux inutiles.",
      include: generatorRules.includePrinciples,
      exclude: generatorRules.excludePrinciples,
      noPublish: true,
      noGitAddDot: true
    },
    expectedJson: {
      global_status: "OK|A_COMPLETER|BLOQUE",
      global_risks: ["risque court"],
      projects: [
        {
          name: "nom",
          decision: "OK|A_COMPLETER|BLOQUE",
          missing_for_local_install: ["fichier ou commande"],
          useless_or_sensitive_files_to_exclude: ["chemin"],
          README_focus: "ce que le README doit expliquer",
          manual_actions: ["action"]
        }
      ]
    },
    projects: preparations.map((item) => ({
      name: item.project.name,
      status04: item.status,
      securityStatus: item.securityStatus,
      githubStatus: item.githubStatus,
      summary: item.contentSummary.summary,
      purpose: item.contentSummary.purpose,
      stack: item.contentSummary.stack,
      localInstall: item.localInstall,
      missingRequiredFiles: item.missingRequiredFiles,
      blockers: item.blockers,
      warnings: item.warnings,
      includeSample: item.filePlan.includeCandidates.slice(0, 35).map((file) => file.path),
      reviewSample: item.filePlan.reviewCandidates.slice(0, 20).map((file) => file.path),
      excludeSample: item.filePlan.excludeCandidates.slice(0, 20).map((file) => file.path)
    }))
  };
  return JSON.stringify(payload, null, 2);
}

function parseAgentJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function applyPreparation(preparation) {
  if (preparation.status === "ARCHIVE_EXCLUE") {
    return { project: preparation.project.name, status: "SKIP", details: "Archive ignoree." };
  }
  const project = preparation.project;
  const targets = [
    join(project.path, "PREPARATION_GITHUB_PUBLIC.md"),
    join(project.path, "PREPARATION_GITHUB_PUBLIC.json"),
    join(project.path, "PREPARATION_GITHUB_PRIVATE.md"),
    join(project.path, "PREPARATION_GITHUB_PRIVATE.json"),
    join(project.path, "PREPARATION_GITHUB_SHOWCASE.md"),
    join(project.path, "PREPARATION_GITHUB_SHOWCASE.json"),
    join(project.path, "README.md"),
    join(project.path, "README_GITHUB_PUBLIC.md"),
    join(project.path, "README_GITHUB_PRIVATE.md"),
    join(project.path, "README_GITHUB_SHOWCASE.md"),
    join(project.path, ".gitignore"),
    join(project.path, ".env.example")
  ];
  try {
    await copyExistingFilesToBackup(project, targets, "preparation-git-public");
    await writeText(join(project.path, "PREPARATION_GITHUB_PUBLIC.md"), renderProjectPreparation(preparation));
    await writeJson(join(project.path, "PREPARATION_GITHUB_PUBLIC.json"), preparation);
    if (!preparation.status.startsWith("BLOQUE") && preparation.status !== "ARCHIVE_EXCLUE") {
      await copyPublicGithubScreenshots(project, preparation.githubScreenshots || []);
      if (preparation.githubSharingMode === "PRIVATE_AND_SHOWCASE") {
        const privatePreparation = { ...preparation, readmeMode: "private" };
        const showcasePreparation = { ...preparation, readmeMode: "showcase" };
        const privateReadme = renderReadmeDraft(privatePreparation);
        const showcaseReadme = renderReadmeDraft(showcasePreparation);
        await writeText(join(project.path, "PREPARATION_GITHUB_PRIVATE.md"), renderProjectPreparation(privatePreparation));
        await writeJson(join(project.path, "PREPARATION_GITHUB_PRIVATE.json"), privatePreparation);
        await writeText(join(project.path, "PREPARATION_GITHUB_SHOWCASE.md"), renderProjectPreparation(showcasePreparation));
        await writeJson(join(project.path, "PREPARATION_GITHUB_SHOWCASE.json"), showcasePreparation);
        await writeText(join(project.path, "README.md"), privateReadme);
        await writeText(join(project.path, "README_GITHUB_PRIVATE.md"), privateReadme);
        await writeText(join(project.path, "README_GITHUB_SHOWCASE.md"), showcaseReadme);
      } else {
        const publicReadme = renderReadmeDraft(preparation);
        await writeText(join(project.path, "README.md"), publicReadme);
        await writeText(join(project.path, "README_GITHUB_PUBLIC.md"), publicReadme);
      }
      await ensureGitignore(project.path);
      if (!existsSync(join(project.path, ".env.example"))) {
        await ensureEnvExample(project.path, preparation.envReferences);
      }
    }
    preparation.missingRequiredFiles = preparation.missingRequiredFiles.filter((file) => !existsSync(join(project.path, file)));
    const build = await runBuildIfAvailable(preparation);
    const status = build.status === "FAIL" ? "FAIL" : "OK";
    return {
      project: project.name,
      status,
      build,
      details: `Rapports de preparation ecrits; aucun Git modifie. Build: ${build.details}`
    };
  } catch (error) {
    return { project: project.name, status: "FAIL", details: error.message };
  }
}

async function runBuildIfAvailable(preparation) {
  if (!preparation.localInstall.buildCommand) {
    return { status: "SKIP", details: "Aucun script build detecte." };
  }
  if (preparation.localInstall.kind !== "node") {
    return { status: "SKIP", details: "Build automatique limite aux projets Node/Vite." };
  }
  try {
    const output = await runPackageScript(preparation.project.path, preparation.localInstall.packageManager || "npm", "build");
    return { status: "OK", details: trimText(output, 220) };
  } catch (error) {
    const fix = await applySafeBuildFixes(preparation.project, error);
    if (fix.changed) {
      try {
        const output = await runPackageScript(preparation.project.path, preparation.localInstall.packageManager || "npm", "build");
        return { status: "OK", details: trimText(`${fix.actions.join("; ")}; build relance OK. ${output}`, 260) };
      } catch (retryError) {
        return { status: "FAIL", details: trimText(`${fix.actions.join("; ")}; build encore en echec: ${retryError.stdout || retryError.stderr || retryError.message}`, 320) };
      }
    }
    return { status: "FAIL", details: trimText(error.stdout || error.stderr || error.message, 260) };
  }
}

async function applySafeBuildFixes(project, error) {
  const message = `${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`;
  const actions = [];
  if (!/three\/examples\/jsm\/controls\/OrbitControls/.test(message)) {
    return { changed: false, actions };
  }
  const files = await findSourceFiles(project.path);
  const targets = [];
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (/(['"])three\/examples\/jsm\/controls\/OrbitControls\1/.test(text)) targets.push(file);
  }
  if (!targets.length) return { changed: false, actions };
  await copyExistingFilesToBackup(project, targets, "vite-build-fix");
  for (const file of targets) {
    const current = await readFile(file, "utf8");
    const next = current.replace(/(['"])three\/examples\/jsm\/controls\/OrbitControls\1/g, "$1three/examples/jsm/controls/OrbitControls.js$1");
    if (next !== current) {
      await writeText(file, next);
      actions.push(`corriger import OrbitControls dans ${toPosixPath(relative(project.path, file))}`);
    }
  }
  return { changed: actions.length > 0, actions };
}

async function findSourceFiles(projectPath) {
  const found = [];
  async function visit(folder) {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(folder, entry.name);
      if (entry.isDirectory()) {
        if ([".git", "node_modules", "dist", "build", ".cache"].includes(entry.name)) continue;
        await visit(fullPath);
        continue;
      }
      if (entry.isFile() && /\.(?:ts|tsx|js|jsx)$/i.test(entry.name)) found.push(fullPath);
    }
  }
  await visit(projectPath);
  return found;
}

function runPackageScript(cwd, manager, script) {
  const command = process.platform === "win32" ? "cmd.exe" : manager;
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", `${manager} run ${script}`]
    : ["run", script];
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, commandArgs, { cwd, windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 30 * 1024 * 1024 }, (error, stdout = "", stderr = "") => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        rejectPromise(error);
        return;
      }
      resolvePromise([stdout, stderr].filter(Boolean).join("\n").trim() || "OK");
    });
  });
}

async function applySafeSecurityCleanup(project) {
  const audit = await readJson(join(project.path, "AUDIT_SECURITE.json"), null);
  if (!String(audit?.status || "").startsWith("FAIL")) {
    return { project: project.name, status: "SKIP", details: "Audit securite deja non bloquant.", actions: [] };
  }

  const findings = audit.findings || [];
  const actions = [];
  const targets = [];
  const envExampleNames = new Set();
  const firebaseFinding = findings.find((finding) =>
    finding.type === "generic-secret" &&
    toPosixPath(finding.path || "").toLowerCase() === "src/utils/firebase.ts"
  );
  const envFindings = findings.filter((finding) => finding.type === "blocked-file" && isPrivateEnvPath(finding.path));

  for (const finding of envFindings) {
    const envPath = join(project.path, cleanGitPath(finding.path));
    if (existsSync(envPath)) {
      targets.push(envPath);
      for (const name of await readEnvVariableNames(envPath)) envExampleNames.add(name);
    }
  }
  if (firebaseFinding) targets.push(join(project.path, "src", "utils", "firebase.ts"));

  if (!targets.length) {
    return { project: project.name, status: "BLOCKED", details: "Aucun nettoyage automatique sur pour ces alertes.", actions: [] };
  }

  const backup = await copyExistingFilesToBackup(project, targets, "security-cleanup-public-git");

  if (firebaseFinding) {
    const result = await rewriteFirebaseConfigToEnv(project.path);
    if (result.changed) actions.push(result.action);
  }

  for (const finding of envFindings) {
    const relativePath = cleanGitPath(finding.path);
    const envPath = join(project.path, relativePath);
    if (!existsSync(envPath)) continue;
    const movedPath = join(backup.backupRoot, `${relativePath}.private`);
    await mkdir(dirname(movedPath), { recursive: true });
    await rename(envPath, movedPath);
    actions.push(`deplacer ${relativePath} hors du projet vers le backup orchestrateur`);
  }

  if (actions.length) {
    await ensureGitignore(project.path);
    if (firebaseFinding) {
      for (const name of firebaseEnvNames()) envExampleNames.add(name);
    }
    await ensureEnvExampleVariables(project.path, [...envExampleNames]);
    await runSecurityAudit(project);
    return {
      project: project.name,
      status: "CLEANED",
      backupRoot: backup.backupRoot,
      details: actions.join("; "),
      actions
    };
  }

  return { project: project.name, status: "BLOCKED", backupRoot: backup.backupRoot, details: "Backup cree mais aucun changement applique.", actions: [] };
}

async function readEnvVariableNames(pathValue) {
  const text = await readFile(pathValue, "utf8").catch(() => "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line))
    .map((line) => line.split("=")[0].trim())
    .filter(Boolean);
}

function isPrivateEnvPath(pathValue) {
  const normalized = toPosixPath(pathValue || "").toLowerCase();
  const base = basename(normalized);
  return [".env", ".env.local", "env.local"].includes(base) || /^\.env\.(?!example$)/i.test(base);
}

async function rewriteFirebaseConfigToEnv(projectPath) {
  const file = join(projectPath, "src", "utils", "firebase.ts");
  if (!existsSync(file)) return { changed: false, action: "firebase.ts absent" };
  const current = await readFile(file, "utf8").catch(() => "");
  if (!current || !/const\s+firebaseConfig\s*=\s*\{[\s\S]*?\};/m.test(current)) {
    return { changed: false, action: "firebaseConfig non reconnu" };
  }
  if (current.includes("import.meta.env.VITE_FIREBASE_API_KEY")) {
    return { changed: false, action: "firebaseConfig deja en variables Vite" };
  }
  const replacement = `const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};`;
  await writeText(file, current.replace(/const\s+firebaseConfig\s*=\s*\{[\s\S]*?\};/m, replacement));
  return { changed: true, action: "remplacer la config Firebase codee en dur par import.meta.env.VITE_FIREBASE_*" };
}

function firebaseEnvNames() {
  return [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID"
  ];
}

async function ensureEnvExampleVariables(projectPath, names) {
  const file = join(projectPath, ".env.example");
  const current = existsSync(file) ? await readFile(file, "utf8").catch(() => "") : "";
  const lines = current.split(/\r?\n/);
  const existing = new Set(lines.map((line) => line.split("=")[0].trim()).filter(Boolean));
  const missing = names.filter((name) => !existing.has(name));
  if (!missing.length && current.trim()) return;
  const next = [
    current.trim(),
    ...missing.map((name) => `${name}=`)
  ].filter(Boolean).join("\n");
  await writeText(file, `${next}\n`);
}

async function runSecurityAudit(project) {
  await new Promise((resolvePromise, rejectPromise) => {
    execFile(process.execPath, [join(orchestratorRoot, "scripts", "audit-project-security.mjs"), "--project", project.path], {
      cwd: orchestratorRoot,
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 30 * 1024 * 1024
    }, (error, stdout = "", stderr = "") => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function ensureGitignore(projectPath) {
  const file = join(projectPath, ".gitignore");
  const required = requiredPublicGitignorePatterns();
  const current = existsSync(file) ? await readFile(file, "utf8").catch(() => "") : "";
  const lines = current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const missing = required.filter((pattern) => !gitignoreHas(lines, pattern));
  if (!gitignoreHas(lines, "!.env.example") && !missing.includes("!.env.example")) missing.push("!.env.example");
  if (!missing.length) return;
  await mkdir(dirname(file), { recursive: true });
  const block = ["", "# Orchestrateur - publication GitHub publique", ...missing].join("\n");
  await writeText(file, `${current.trim()}${current.trim() ? "\n" : ""}${block}\n`);
}

function requiredPublicGitignorePatterns() {
  const groups = githubRules.gitOnlyPublication?.requiredGitignoreGroups || [];
  const grouped = groups.flatMap((group) => group.patterns || []);
  const generatedDirs = (generatorRules.excludeDirectories || [])
    .map((dir) => toPosixPath(dir).replace(/^\/+|\/+$/g, ""))
    .filter((dir) => dir && dir !== ".git")
    .map((dir) => `${dir}/`);
  const generatedFragments = (generatorRules.excludePathFragments || [])
    .map((fragment) => toPosixPath(fragment).replace(/^\/+|\/+$/g, ""))
    .filter((fragment) => fragment.includes("/") && !/(cookies|env\.local|private|secrets)/i.test(fragment))
    .map((fragment) => `${fragment}/`);
  const excludedExtensions = (generatorRules.excludeExtensions || [])
    .map((extension) => String(extension || "").trim())
    .filter(Boolean)
    .map((extension) => `*${extension.startsWith(".") ? extension : `.${extension}`}`);
  return unique([...grouped, ...generatedDirs, ...generatedFragments, ...excludedExtensions]);
}

async function ensureEnvExample(projectPath, envReferences) {
  const file = join(projectPath, ".env.example");
  const names = unique(envReferences);
  const lines = [
    "# Exemple de configuration locale",
    "# Ne jamais mettre de vraie cle API dans ce fichier.",
    ...(names.length ? names.map((name) => `${name}=`) : ["# Aucune variable obligatoire detectee pour le lancement local."])
  ];
  await writeText(file, `${lines.join("\n")}\n`);
}

async function copyPublicGithubScreenshots(project, screenshots) {
  for (const item of screenshots) {
    const source = join(project.path, item.source);
    const target = join(project.path, item.target);
    if (!existsSync(source)) continue;
    if (resolve(source).toLowerCase() === resolve(target).toLowerCase()) continue;
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

function gitignoreHas(lines, pattern) {
  const wanted = String(pattern || "").toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
  return lines.some((line) => {
    const normalized = line.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
    return normalized === wanted || normalized.includes(wanted);
  });
}

function renderProjectPreparation(preparation) {
  const modeLabel = preparation.readmeMode === "private"
    ? "prive interne"
    : preparation.readmeMode === "showcase"
      ? "vitrine publique"
      : preparation.githubSharingMode === "PRIVATE_AND_SHOWCASE"
        ? "prive + vitrine"
        : "public";
  return `# Preparation GitHub ${modeLabel} - ${preparation.project.title}

- Date: ${preparation.generatedAt}
- Statut 04: **${preparation.status}**
- Mode GitHub: ${preparation.githubSharingMode || "PUBLIC"}
- Securite: ${preparation.securityStatus}
- GitHub actuel: ${preparation.githubStatus}
- Git local: ${preparation.git.hasGit ? preparation.git.status : "NO_GIT"}
- Publication/push: non

## But public

${preparation.contentSummary.summary || "Projet a documenter."}

## Installation locale detectee

- Type: ${preparation.localInstall.kind}
- Installation: ${preparation.localInstall.installCommand || "A documenter"}
- Dev: ${preparation.localInstall.devCommand || "-"}
- Build: ${preparation.localInstall.buildCommand || "-"}
- Test: ${preparation.localInstall.testCommand || "-"}

## Fichiers manquants

${preparation.missingRequiredFiles.length ? preparation.missingRequiredFiles.map((item) => `- ${item}`).join("\n") : "- Aucun fichier public requis manquant."}

## Actions

${preparation.actions.map((item) => `- ${item}`).join("\n")}

## Changements Git detectes

${renderGitChangePlan(preparation.gitChangePlan)}

## A inclure dans le depot public

${publicationPlanForReport(preparation).includeCandidates.slice(0, 80).map((item) => `- ${item.path}`).join("\n") || "- Aucun fichier candidat detecte."}

## A exclure du depot public

${publicationPlanForReport(preparation).excludeCandidates.slice(0, 80).map((item) => `- ${item.path} (${item.reason})`).join("\n") || "- Aucun fichier exclu dans le manifeste limite."}

## A revoir avant suivi Git

${preparation.filePlan.reviewCandidates.slice(0, 80).map((item) => `- ${item.path} (${item.reason})`).join("\n") || "- Aucun fichier en revue dans le manifeste limite."}

## Filtre de confidentialite de la vitrine

${renderShowcaseFilter(preparation.showcaseFilePlan)}
`;
}

function publicationPlanForReport(preparation) {
  return preparation.readmeMode === "showcase" && preparation.showcaseFilePlan
    ? preparation.showcaseFilePlan
    : preparation.filePlan;
}

function renderShowcaseFilter(plan) {
  if (!plan) return "- Non applicable: le projet ne requiert pas de vitrine publique separee.";
  if (!plan.excludeCandidates.length) return "- OK: aucun contenu d'infrastructure privee detecte.";
  return plan.excludeCandidates.slice(0, 80)
    .map((item) => `- ${item.path}: exclu (${item.reason}; ${formatShowcaseFindings(item.findings)})`)
    .join("\n");
}

function formatShowcaseFindings(findings) {
  return unique((findings || []).map((item) => item.line ? `${item.type} ligne ${item.line}` : item.type)).join(", ") || "controle de contenu";
}

function renderGitChangePlan(plan) {
  if (!plan) return "- Aucun plan Git disponible.";
  return [
    "### Utiles pour GitHub public",
    renderGitChangeList(plan.publicUseful, "Aucun changement public utile."),
    "",
    "### Internes ignores",
    renderGitChangeList(plan.ignoredLocal, "Aucun changement interne ignore."),
    "",
    "### Internes suivis a retirer de l'index public",
    renderGitChangeList(plan.trackedInternal, "Aucun fichier interne suivi a retirer."),
    "",
    "### Sorties generees obsoletes a archiver avant retrait",
    renderGitChangeList(plan.generatedRetirements, "Aucune sortie generee obsolete."),
    "",
    "### A revoir",
    renderGitChangeList(plan.reviewRequired, "Aucun changement Git a revoir.")
  ].join("\n");
}

function renderGitChangeList(items, emptyText) {
  if (!items?.length) return `- ${emptyText}`;
  return items.slice(0, 80).map((item) => `- ${item.path} (${item.status}; ${item.reason})`).join("\n");
}

function renderReadmeDraft(preparation) {
  const readmeMode = preparation.readmeMode || (preparation.githubSharingMode === "PRIVATE_AND_SHOWCASE" ? "private" : "public");
  const documentationOnlyShowcase = isDocumentationOnlyShowcase(preparation);
  const modeIntro = readmeMode === "private"
    ? "Ce depot prive interne presente le travail en cours, les fonctions, l'installation et les captures utiles, sans publier les secrets ni les fichiers locaux sensibles."
    : readmeMode === "showcase"
      ? "Ce depot vitrine public presente une version nettoyee et partageable du projet. Il doit rester installable localement quand le projet le permet, sans secrets ni donnees privees."
      : "Ce depot public presente le concept, les fonctions, les choix de conception, les outils utilises, les commandes locales et les captures d'ecran de l'application.";
  const details = preparation.contentSummary.details || {};
  const fonctionnement = structuredText(details.fonctionnement || details.application);
  const conception = structuredText(details.conception);
  const packageInfo = preparation.contentSummary.package || {};
  const functions = unique([
    ...asArray(preparation.contentSummary.functions),
    ...asArray(details.capabilities)
  ]).slice(0, 30);
  const updates = unique([
    ...asArray(preparation.contentSummary.recentUpdates),
    ...asArray(details.recentUpdates)
  ]).filter(isProjectUpdate).slice(0, 16);
  const tools = unique([
    ...asArray(details.tools),
    ...asArray(details.techniques)
  ]).slice(0, 30);
  const stack = unique([
    ...asArray(preparation.contentSummary.stack),
    ...asArray(details.techniques)
  ]).slice(0, 30);
  const automations = unique(asArray(details.automations)).slice(0, 30);
  const installLines = documentationOnlyShowcase
    ? []
    : [preparation.localInstall.installCommand].filter(Boolean);
  const runLines = [
    preparation.localInstall.devCommand,
    preparation.localInstall.startCommand,
    preparation.localInstall.buildCommand
  ].filter(Boolean);
  const screenshotLines = (preparation.githubScreenshots || [])
    .map((item) => `![Capture ${item.kind}](${item.target.replace(/\\/g, "/")})`);
  const draft = `# ${preparation.project.title}

## Rapport complet

${modeIntro}

## Demarrage rapide

${renderGithubQuickStart(preparation, installLines, runLines)}

## Installation locale

${documentationOnlyShowcase
    ? renderDocumentationShowcaseInstallation(preparation)
    : renderGithubInstallation(preparation, details, installLines)}

## Lancement

${documentationOnlyShowcase
    ? "Cette vitrine documentaire ne lance aucun service. Les configurations et procedures operationnelles detaillees restent dans le depot prive."
    : runLines.length
    ? `\`\`\`powershell\n${runLines.join("\n")}\n\`\`\``
    : "Aucune commande de lancement n'est fournie dans les fichiers publies."}

## Utilisation

${documentationOnlyShowcase
    ? renderDocumentationShowcaseUsage()
    : githubUsage(preparation, details)}

## Concept

${preparation.contentSummary.summary || "Projet prepare pour une diffusion publique controlee."}

${preparation.contentSummary.purpose || "Documenter le projet et permettre une installation locale."}

${preparation.contentSummary.audience ? `Public vise: ${preparation.contentSummary.audience}\n` : ""}

## Fonctionnement de l'application

${fonctionnement || preparation.contentSummary.purpose || "Fonctionnement a documenter."}

## Fonctions de l'application

${markdownList(functions, "Fonctions a documenter.")}

## Actualisations et evolution

${markdownList(updates.length ? updates : ["README public enrichi avec rapport fonctionnel, captures GitHub et details de conception."], "Aucune actualisation publique renseignee.")}

## Comment le projet a ete reflechi et construit

${conception || "Conception a documenter."}

Cette section doit expliquer les choix qui ont guide le projet: besoin de depart, structure retenue, modules principaux, compromis techniques, interface ou logique metier, et raisons des outils utilises.

### Outils, IA et moteurs utilises

${markdownList(tools, "Outils a documenter.")}

### Options techniques detectees

${markdownList([
    valueLine("Type de projet", preparation.localInstall.kind),
    valueLine("Gestionnaire", preparation.localInstall.packageManager),
    valueLine("Nom package", packageInfo.name),
    valueLine("Version", packageInfo.version),
    valueLine("Lien public", preparation.project.publicUrl),
    valueLine("Statut securite", preparation.securityStatus)
  ], "Options techniques a documenter.")}

### Stack et dependances principales

${markdownList(stack, "Stack a documenter.")}

### Scripts disponibles

${markdownList(packageInfo.scripts || preparation.localInstall.scripts || [], "Aucun script detecte.")}

### Dependances applicatives

${markdownList(packageInfo.dependencies || [], "Aucune dependance applicative detectee.")}

### Dependances de developpement

${markdownList(packageInfo.devDependencies || [], "Aucune dependance de developpement detectee.")}

## Automatisations et comportements internes

${markdownList(automations, "Automatisations a documenter.")}

## Captures d'ecran

${screenshotLines.length ? screenshotLines.join("\n\n") : "Aucune capture d'ecran n'est encore disponible. La preparation GitHub doit etre completee avec une capture du projet quand il s'agit d'une application."}

## Variables d'environnement

${preparation.envReferences.length
    ? "Copier `.env.example` vers `.env` en local puis remplir les valeurs privees."
    : "Aucune variable d'environnement n'est requise d'apres les fichiers publies."}

## Securite

Ne jamais publier \`.env\`, tokens, sessions, logs sensibles, cles privees ou donnees personnelles.
`;
  return readmeMode === "showcase"
    ? sanitizeShowcaseText(draft, showcaseSafetyOptions(preparation.project))
    : draft;
}

function markdownList(items, emptyText) {
  const lines = unique(asArray(items)).filter(Boolean);
  return lines.length ? lines.map((item) => `- ${item}`).join("\n") : `- ${emptyText}`;
}

function valueLine(label, value) {
  return value ? `${label}: ${value}` : "";
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => asArray(item));
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => {
      const values = asArray(child);
      return values.map((item) => `${readableLabel(key)}: ${item}`);
    });
  }
  const text = String(value).trim();
  if (!text || /^\[object Object\]$/i.test(text)) return [];
  return [text];
}

function structuredText(value) {
  return asArray(value).join("\n");
}

function readableLabel(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function githubUsage(preparation, details) {
  const documented = structuredText(details.utilisation);
  return documented.replace(/[`#*_\-\s]/g, "").length >= 40
    ? documented
    : defaultGithubUsage(preparation);
}

function isDocumentationOnlyShowcase(preparation) {
  if (preparation.readmeMode !== "showcase") return false;
  const paths = (preparation.showcaseFilePlan?.includeCandidates || []).map((item) => toPosixPath(item.path).toLowerCase());
  return !paths.some((path) =>
    /^(?:app|bin|lib|scripts?|src)\//.test(path) ||
    /(?:^|\/)(?:cargo\.toml|compose\.ya?ml|docker-compose\.ya?ml|go\.mod|package\.json|pyproject\.toml|requirements[^/]*\.txt)$/.test(path) ||
    /\.(?:c|cjs|cpp|cs|go|java|js|jsx|mjs|php|py|rb|rs|sh|ts|tsx)$/.test(path)
  );
}

function renderDocumentationShowcaseInstallation(preparation) {
  const commands = [...githubCloneCommands(preparation), "Get-Content README.md"];
  return `Cette vitrine contient uniquement la documentation generale partageable. Pour la consulter localement:\n\n${renderCommandBlock(commands)}\n\nAucune configuration serveur privee, adresse reseau ou sauvegarde operationnelle n'est incluse.`;
}

function renderDocumentationShowcaseUsage() {
  return "Lire `README.md` pour la vue d'ensemble, `FICHE_PROJET.md` pour les fonctions, `INSTALLATION_FR.md` pour les pre-requis generaux et `CHANGELOG_FR.md` pour les evolutions. Le deploiement reel s'appuie sur des fichiers prives absents de cette vitrine.";
}

function renderCommandBlock(lines) {
  return `\`\`\`powershell\n${lines.filter(Boolean).join("\n")}\n\`\`\``;
}

function applyReadmeGuideValidation(preparation) {
  const modes = preparation.githubSharingMode === "PRIVATE_AND_SHOWCASE"
    ? ["private", "showcase"]
    : ["public"];
  const results = modes.map((mode) => {
    const modePreparation = { ...preparation, readmeMode: mode };
    return {
      mode,
      ...validateGithubReadmeGuide(renderReadmeDraft(modePreparation), readmeGuideOptions(modePreparation))
    };
  });
  preparation.readmeGuideValidation = {
    status: results.every((item) => item.status === "OK") ? "OK" : "FAIL",
    modes: results
  };
  if (preparation.readmeGuideValidation.status === "OK") return;
  preparation.blockers.push("readme-installation-utilisation-incomplet");
  preparation.actions.unshift("completer le README: demarrage rapide, installation, lancement et utilisation");
  preparation.status = "BLOQUE_README_INCOMPLET";
}

function readmeGuideOptions(preparation) {
  const runCommands = [
    preparation.localInstall.devCommand,
    preparation.localInstall.startCommand,
    preparation.localInstall.buildCommand
  ].filter(Boolean);
  return {
    requiredSections: generatorRules.requiredReadmeSections,
    requiredCommands: [
      preparation.localInstall.installCommand,
      verificationCommandFor(preparation),
      ...runCommands
    ].filter((command) => command && !String(command).startsWith("#")),
    requireClone: githubCloneCommands(preparation).length > 0
  };
}

function renderGithubQuickStart(preparation, installLines, runLines) {
  const verificationCommand = verificationCommandFor(preparation);
  const commands = unique([
    ...githubCloneCommands(preparation),
    ...installLines,
    verificationCommand,
    runLines[0]
  ]).filter(Boolean);
  const prerequisites = [
    "Git installe localement.",
    preparation.localInstall.kind === "node" ? "Node.js 20 ou plus recent." : "",
    preparation.localInstall.packageManager ? `Gestionnaire de paquets: ${preparation.localInstall.packageManager}.` : ""
  ];
  return `### Pre-requis\n\n${markdownList(prerequisites, "Verifier les pre-requis du projet.")}\n\n### Installer et lancer\n\n${commands.length ? renderCommandBlock(commands) : "Consulter la section Installation locale."}`;
}

function githubCloneCommands(preparation) {
  const mode = preparation.readmeMode || "public";
  const links = preparation.project.links || {};
  let repositoryUrl = mode === "private"
    ? (links.githubPrivate || links.github || "")
    : mode === "showcase"
      ? (links.githubShowcase || links.github || "")
      : (links.github || "");
  if (!repositoryUrl) {
    const owner = /^https:\/\/github\.com\/([^/]+)\//i.exec(preparation.project.githubUrl || "")?.[1];
    const repository = mode === "private"
      ? preparation.githubRepositories?.private
      : mode === "showcase"
        ? preparation.githubRepositories?.showcase
        : "";
    if (owner && repository) repositoryUrl = `https://github.com/${owner}/${repository}`;
  }
  if (!repositoryUrl) repositoryUrl = preparation.project.githubUrl || "";
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(repositoryUrl)) return [];
  const folder = repositoryUrl.split("/").filter(Boolean).at(-1).replace(/\.git$/i, "");
  return [`git clone ${repositoryUrl}.git`, `cd ${folder}`];
}

function verificationCommandFor(preparation) {
  if (asArray(preparation.localInstall.scripts).includes("check")) {
    return `${preparation.localInstall.packageManager || "npm"} run check`;
  }
  return preparation.localInstall.testCommand || "";
}

function renderGithubInstallation(preparation, details, installLines) {
  const commands = unique([
    ...githubCloneCommands(preparation),
    ...installLines,
    verificationCommandFor(preparation)
  ]).filter(Boolean);
  const lines = [];
  const documentedInstallation = structuredText(details.installation);
  if (documentedInstallation) {
    lines.push(documentedInstallation);
    lines.push("");
  }
  lines.push("### Pre-requis");
  lines.push(markdownList([
    preparation.localInstall.kind === "node" ? "Node.js installe localement." : "",
    preparation.localInstall.packageManager ? `Gestionnaire detecte: ${preparation.localInstall.packageManager}.` : "",
    preparation.envReferences.length ? "Creer un fichier `.env` local a partir de `.env.example` si des variables sont necessaires." : ""
  ], "Verifier les pre-requis propres au projet dans le README."));
  lines.push("");
  lines.push("### Commandes");
  lines.push(commands.length ? renderCommandBlock(commands) : "Commande d'installation a documenter selon le projet.");
  return lines.join("\n");
}

function defaultGithubUsage(preparation) {
  if (preparation.localInstall.devCommand) {
    return "Apres installation, lancer le serveur de developpement, ouvrir l'adresse locale affichee dans le terminal, puis tester les fonctions principales de l'interface.";
  }
  if (preparation.localInstall.startCommand) {
    return "Apres installation, lancer la commande de demarrage puis suivre les indications affichees par l'application.";
  }
  if (preparation.localInstall.buildCommand) {
    return "Construire le projet puis suivre la documentation du depot pour servir ou integrer les fichiers generes.";
  }
  return "Consulter les sections Fonctionnement et Fonctions pour comprendre le parcours d'utilisation du projet.";
}

async function ensureGithubScreenshots(project, securityStatus) {
  if (shouldRun && isSecurityAllowedForPrivateSharing(securityStatus) && isLaunchableApplication(project)) {
    await execFileText(
      process.execPath,
      [join(orchestratorRoot, "scripts", "capture-project-screenshots.mjs"), "--project", project.path, "--capture", "--force", "--github-only"],
      10 * 60 * 1000,
      { cwd: orchestratorRoot, maxBuffer: 30 * 1024 * 1024 }
    ).catch(() => null);
  }
  return publicGithubScreenshots(project);
}

function isLaunchableApplication(project) {
  const scripts = new Set(project.scripts || []);
  return ["dev", "preview", "start"].some((script) => scripts.has(script));
}

async function publicGithubScreenshots(project) {
  const files = await projectScreenshotFiles(project);
  const selected = [];
  const desktop = files.find((file) => /desktop\.(png|jpe?g|webp)$/i.test(file));
  const mobile = files.find((file) => /mobile\.(png|jpe?g|webp)$/i.test(file));
  if (desktop) selected.push({ kind: "desktop", source: desktop, target: `docs/github-captures/${basename(desktop)}` });
  if (mobile && mobile !== desktop) selected.push({ kind: "mobile", source: mobile, target: `docs/github-captures/${basename(mobile)}` });
  for (const file of files) {
    if (selected.length >= 2) break;
    if (!selected.some((item) => item.source === file)) selected.push({ kind: "capture", source: file, target: `docs/github-captures/${basename(file)}` });
  }
  return selected;
}

async function projectScreenshotFiles(project) {
  const githubCaptureRoot = join(project.path, "docs", "github-captures");
  const fromGithubCaptures = (await readdir(githubCaptureRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => toPosixPath(`docs/github-captures/${entry.name}`));
  const fromRegistry = (project.screenshots || [])
    .filter(Boolean)
    .filter((file) => existsSync(join(project.path, file)));
  const captureRoot = join(project.path, "docs", "captures");
  const fromDisk = (await readdir(captureRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => toPosixPath(`docs/captures/${entry.name}`));
  return sortScreenshotsNewestFirst(unique([...fromGithubCaptures, ...fromRegistry, ...fromDisk]));
}

function sortScreenshotsNewestFirst(files) {
  return [...files].sort((left, right) => {
    const stampDiff = screenshotStamp(right).localeCompare(screenshotStamp(left));
    if (stampDiff) return stampDiff;
    return screenshotViewportRank(left) - screenshotViewportRank(right);
  });
}

function screenshotStamp(file) {
  return String(file || "").match(/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/)?.[0] || "";
}

function screenshotViewportRank(file) {
  const text = String(file || "").toLowerCase();
  if (text.includes("desktop")) return 0;
  if (text.includes("mobile")) return 1;
  return 2;
}

function renderRules() {
  return alignedMarkdownTable(
    ["Regle", "Decision"],
    [
      ["But", "Un depot public doit permettre une installation locale comprehensible."],
      ["Non-public", "Preparer automatiquement un depot prive interne et une vitrine publique nettoyee."],
      ["Inclure", generatorRules.includePrinciples.join("; ")],
      ["Exclure", generatorRules.excludePrinciples.join("; ")],
      ["Audit", "OK_PUBLIC obligatoire pour public complet; OK_PUBLIC ou OK_PRIVATE pour partage prive/vitrine nettoyee."],
      ["Git", "Controle des fichiers utiles, des fichiers internes ignores et des changements a revoir."],
      ["IA", "Mistral valide en premier; Qwen prend le relais ou compare si demande."]
    ]
  );
}

function renderFilesSection(items) {
  return items.map((item) => {
    const include = item.filePlan.includeCandidates.slice(0, 12).map((file) => file.path).join(", ") || "-";
    const review = item.filePlan.reviewCandidates.slice(0, 8).map((file) => file.path).join(", ") || "-";
    const exclude = item.filePlan.excludeCandidates.slice(0, 8).map((file) => file.path).join(", ") || "-";
    return `### ${item.project.name}

${alignedMarkdownTable(
  ["Type", "Fichiers"],
  [
    ["Inclure", include],
    ["Revoir", review],
    ["Exclure", exclude]
  ]
)}`;
  }).join("\n\n");
}

function renderCleanupSection(items) {
  if (!shouldRun) return "- Nettoyage non execute en dry-run/test.";
  if (!items.length) return "- Aucun projet nettoye.";
  return alignedMarkdownTable(
    ["Projet", "Statut", "Details", "Backup"],
    items.map((item) => [
      item.project,
      item.status,
      item.details || "-",
      item.backupRoot || "-"
    ])
  );
}

function renderMistralDraftSection(items) {
  if (!shouldRun) return "- Non execute en dry-run/test.";
  if (!items.length) return "- Aucune redaction Mistral lancee.";
  return alignedMarkdownTable(
    ["Projet", "Statut", "Details"],
    items.map((item) => [item.project, item.status, item.details || "-"])
  );
}

function renderAiSection(validation) {
  if (!useApi) return "- Validation IA non demandee. Ajouter `--api` pour appeler Mistral avec relais Qwen.";
  const rows = validation.calls.map((call) => [
    call.agent,
    call.status,
    call.model || "-",
    call.durationMs ? `${call.durationMs} ms` : "-",
    call.reason || (call.parsed ? "JSON valide" : call.text || "-")
  ]);
  const selected = validation.selected?.agent
    ? `\n\nAgent retenu: **${validation.selected.agent}**.`
    : "\n\nAucun agent IA exploitable.";
  const parsed = validation.selected?.parsed
    ? `\n\n### Synthese IA retenue\n\n\`\`\`json\n${JSON.stringify(validation.selected.parsed, null, 2)}\n\`\`\``
    : "";
  return `${alignedMarkdownTable(["Agent", "Statut", "Modele", "Duree", "Details"], rows)}${selected}${parsed}`;
}

async function ensureMistralProjectContent(project) {
  try {
    const { stdout } = await execFileText(
      process.execPath,
      [
        join(orchestratorRoot, "scripts", "generate-project-fiche-ai-draft.mjs"),
        "--project",
        project.path,
        "--apply",
        "--agent",
        "mistral",
        "--refresh-existing",
        "--max-projects",
        "1"
      ],
      5 * 60 * 1000,
      { cwd: orchestratorRoot, maxBuffer: 20 * 1024 * 1024 }
    );
    const skipped = /NO_ACTION|SKIPPED_/i.test(stdout || "");
    return {
      project: project.name,
      status: skipped ? "SKIP" : "OK",
      details: trimText(stdout || "OK", 220)
    };
  } catch (error) {
    return {
      project: project.name,
      status: "WARN",
      details: trimText(error.stdout || error.stderr || error.message, 260)
    };
  }
}

function defaultGeneratorRules() {
  return {
    maxScannedFiles: 4500,
    maxManifestFiles: 220,
    maxPublicFileBytes: 10 * 1024 * 1024,
    requiredPublicFiles: [".gitignore", "README.md"],
    includePrinciples: [
      "README et documentation d'installation",
      "manifestes de dependances et lockfiles",
      "code source necessaire au lancement local",
      "assets publics utiles a l'application",
      "exemples de configuration sans secret"
    ],
    excludePrinciples: [
      "secrets et fichiers .env reels",
      "node_modules, builds, caches et sorties generees",
      "sessions, cookies et profils navigateur",
      "archives, backups, logs et donnees personnelles",
      "cles privees et bases locales non anonymisees"
    ],
    excludeDirectories: [
      ".git",
      "node_modules",
      "dist",
      "build",
      "out",
      ".next",
      ".nuxt",
      ".cache",
      ".playwright-cli",
      ".playwright-mcp",
      "coverage",
      "logs",
      "sessions",
      "session",
      "baileys-auth",
      "backups",
      "backup",
      "archives",
      "_archive",
      "_deploy",
      "output",
      "99_Archive"
    ],
    excludePathFragments: [
      ".whatsapp-web-profile",
      ".whatsapp-web-chrome-profile",
      "cookies",
      "env.local",
      "secrets",
      "private",
      "runtime/jobs",
      "runtime/outputs",
      "public/generated/videos",
      "docs/daily-tests/evidence",
      "docs/captures/",
      "captures/",
      "preparation_github",
      "rapport_fonctionnalite",
      "rapport_reparation_fonctionnalite",
      "audit_securite",
      "audit_architecture",
      "audit_nettoyage",
      "audit_optimisation"
    ],
    excludeFileNames: [
      ".env",
      ".env.local",
      "env.local",
      "env.Local",
      "id_rsa",
      "id_ed25519",
      ".project-orchestrator.json",
      "metadata.json"
    ],
    excludeExtensions: [".pem", ".key", ".p12", ".pfx", ".zip", ".7z", ".rar", ".bak"],
    reviewExtensions: [".xlsx", ".xls", ".csv", ".sqlite", ".db"],
    reviewPathFragments: ["data/", "database/", "exports/", "uploads/", "captures-privees/"]
  };
}

function statusCounts(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function preparationGlobalStatus(counts, hasExecutionFailure) {
  if (hasExecutionFailure) return "FAIL";
  const ready = counts.READY_GITHUB_PUBLIC || 0;
  const readyPrivate = counts.READY_GITHUB_PRIVATE_SHOWCASE || 0;
  const blocked = (counts.BLOQUE_SECURITE || 0) + (counts.BLOQUE_GITHUB_PUBLIC || 0) + (counts.BLOQUE_GITHUB_PRIVATE || 0);
  const incomplete = (counts.A_COMPLETER_PUBLIC || 0) + (counts.A_COMPLETER_PRIVATE_SHOWCASE || 0) + (counts.A_INITIALISER_GIT || 0) + (counts.REVUE_GIT_REQUISE || 0) + (counts.A_VALIDER_SECURITE || 0);
  const nonPublic = counts.ARCHIVE_EXCLUE || 0;
  if ((ready || readyPrivate) && (blocked || incomplete || nonPublic)) return "PRET_PARTIEL";
  if (blocked) return "BLOQUE_GITHUB_PUBLIC";
  if (incomplete) return "A_COMPLETER";
  if (readyPrivate && !ready) return "PRET_GITHUB_PRIVE_VITRINE";
  if (nonPublic) return "ARCHIVE_EXCLUE";
  return "OK";
}

function sumGitChanges(kind) {
  return preparations.reduce((total, item) => total + (item.gitChangePlan?.[kind]?.length || 0), 0);
}

function isArchiveProject(project) {
  return project.id === "99-archive" || project.name === "99_Archive" || project.category === "archive";
}

function githubSharingModeFor(project, securityStatus, publicationStatus) {
  if (isArchiveProject(project) || publicationStatus === "ARCHIVE_ONLY") return "ARCHIVE";
  if (String(securityStatus || "").startsWith("FAIL")) return "BLOCKED";
  if (securityStatus === "OK_PRIVATE" || publicationStatus === "PRIVATE_INTERNAL" || project.status === "PRIVATE_INTERNAL") {
    return "PRIVATE_AND_SHOWCASE";
  }
  return "PUBLIC";
}

function showcaseCandidates(filePlan, screenshots) {
  return [
    ...(filePlan?.includeCandidates || []),
    ...(screenshots || []).map((item) => ({ path: item.target })),
    ...[".gitignore", ".env.example", "FICHE_PROJET.md", "INSTALLATION_FR.md", "CHANGELOG_FR.md"]
      .map((path) => ({ path }))
  ];
}

function showcaseSafetyOptions(project) {
  const links = project?.links || {};
  return {
    ...(sharingRules.showcaseSafety || {}),
    safeHosts: unique([
      ...(sharingRules.showcaseSafety?.allowedPublicHosts || []),
      project?.publicUrl,
      project?.hostingerUrl,
      project?.githubUrl,
      ...Object.values(links)
    ])
  };
}

function isSecurityAllowedForPrivateSharing(status) {
  const allowed = githubRules.allowedPrivateSharingSecurityStatus || ["OK_PUBLIC", "OK_PRIVATE"];
  return allowed.includes(status);
}

function repositoryPlanFor(project, mode) {
  const base = repositoryNameFromProject(project);
  if (mode === "PRIVATE_AND_SHOWCASE") {
    return {
      private: `${base}${sharingRules.privateRepositorySuffix || "-private"}`,
      showcase: `${base}${sharingRules.showcaseRepositorySuffix || "-showcase"}`
    };
  }
  if (mode === "PUBLIC") return { public: base };
  return {};
}

function repositoryNameFromProject(project) {
  return String(basename(project.relativePath || project.path || project.name))
    .replace(/^\d+[-_]+/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "projet";
}

function defaultPrivateAndShowcaseRules() {
  return {
    privateRepositorySuffix: "-private",
    showcaseRepositorySuffix: "-showcase",
    privateRepositoryVisibility: "private",
    showcaseRepositoryVisibility: "public",
    requiredFiles: [".gitignore", "README.md"],
    privatePrinciples: [
      "depot prive interne",
      "aucun secret reel",
      "documentation complete et captures"
    ],
    showcasePrinciples: [
      "vitrine publique nettoyee",
      "installable localement quand possible",
      "aucun secret ni donnee privee"
    ]
  };
}
