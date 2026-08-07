param(
  [Parameter(Mandatory=$true)][string]$Project
)

Write-Host "Verification avant publication GitHub: $Project"
$OrchestratorRoot = Split-Path -Parent $PSScriptRoot
Push-Location $OrchestratorRoot
try {
  npm run security -- --project "$Project"
} finally {
  Pop-Location
}
