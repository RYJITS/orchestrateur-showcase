import { runAutomation } from "./lib/automation-runner.mjs";

const result = await runAutomation("monthly");
console.log(`Routine monthly: ${result.status}`);
console.log(`Rapport: ${result.report.mdPath}`);
