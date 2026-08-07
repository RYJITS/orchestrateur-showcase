param(
  [Parameter(Mandatory=$true)][string]$Project,
  [string]$Action = "change"
)

Write-Host "Orchestrateur pre-project-change: $Project ($Action)"
if (-not (Test-Path -LiteralPath $Project)) {
  throw "Projet introuvable: $Project"
}

$OrchestratorRoot = Split-Path -Parent $PSScriptRoot
Push-Location $OrchestratorRoot
try {
  npm run backup:prepare -- --project "$Project" --action "$Action" --docs
  npm run security -- --project "$Project"
} finally {
  Pop-Location
}
