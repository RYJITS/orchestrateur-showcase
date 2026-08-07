import {
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  scanProject,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const registry = await loadRegistry();
const refs = args.project
  ? await projectsFromArgs(args)
  : registry.projects.length
    ? registry.projects.map((project) => ({ name: project.name, path: project.path }))
    : await projectsFromArgs(args);

const results = [];
for (const ref of refs) {
  const project = await scanProject(ref);
  results.push({
    name: project.name,
    path: project.path,
    category: project.category,
    stack: project.stack,
    scripts: project.scripts,
    packageName: project.packageName,
    hasPackageJson: project.hasPackageJson
  });
}

const rows = results.map((item) => [
  item.name,
  item.category,
  item.stack.join(", ") || "non detecte",
  item.scripts.join(", ") || "aucun",
  item.packageName || "aucun"
]);

const report = await writeReport(
  "global",
  "detect-project-stack",
  `# Detection stacks projets

- Date: ${nowIso()}
- Projets: ${results.length}

${markdownTable(["Projet", "Categorie", "Stack", "Scripts npm", "Package"], rows)}
`,
  { generatedAt: nowIso(), results }
);

console.log(`Detection stack terminee: ${results.length} projet(s).`);
console.log(`Rapport: ${report.mdPath}`);
