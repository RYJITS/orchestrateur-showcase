import { runAutomation } from "./lib/automation-runner.mjs";

const result = await runAutomation("daily");
console.log(`Routine daily: ${result.status}`);
console.log(`Rapport: ${result.report.mdPath}`);
