import {
  gitStatus,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const registry = await loadRegistry();
const refs = args.project
  ? await projectsFromArgs(args)
  : registry.projects.map((project) => ({ name: project.name, path: project.path }));
const results = [];

for (const project of refs) {
  const git = await gitStatus(project.path);
  results.push({ project, git });
}

const rows = results.map((item) => [
  item.project.name,
  item.git.hasGit ? "oui" : "non",
  item.git.dirty ? "dirty" : "clean",
  item.git.status || "NO_GIT"
]);

const report = await writeReport(
  "global",
  "git-change-report",
  `# Rapport changements Git

- Date: ${nowIso()}
- Projets: ${results.length}

${markdownTable(["Projet", "Git", "Etat", "Details"], rows)}
`,
  { generatedAt: nowIso(), results }
);

console.log(`Rapport Git termine: ${results.length} projet(s).`);
console.log(`Rapport: ${report.mdPath}`);
