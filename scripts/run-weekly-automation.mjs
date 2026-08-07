import { runAutomation } from "./lib/automation-runner.mjs";

const result = await runAutomation("weekly");
console.log(`Routine weekly: ${result.status}`);
console.log(`Rapport: ${result.report.mdPath}`);
