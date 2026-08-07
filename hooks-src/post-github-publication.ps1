param(
  [string]$Project = "",
  [string]$Status = "DRY_RUN"
)

Write-Host "[00_ORCHESTRATEUR] Post GitHub publication hook"
Write-Host "Project: $Project"
Write-Host "Status: $Status"
Write-Host "Reminder: record project memory and run npm run memoire:update from Conpetances."
