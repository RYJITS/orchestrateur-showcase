param(
  [Parameter(Mandatory=$true)][string]$Project
)

Write-Host "Orchestrateur post-project-change: $Project"
$OrchestratorRoot = Split-Path -Parent $PSScriptRoot
Push-Location $OrchestratorRoot
try {
  npm run verify:functionality -- --project "$Project"
  npm run fiches -- --project "$Project"
  npm run site-ma-methode -- --sync
} finally {
  Pop-Location
}
