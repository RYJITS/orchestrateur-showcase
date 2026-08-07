param(
  [string]$Project = "",
  [switch]$Apply
)

Write-Host "[00_ORCHESTRATEUR] Pre cleanup/archive hook"
Write-Host "Project: $Project"
Write-Host "Apply: $Apply"
Write-Host "Required: scan, dry-run report, backup guard, then explicit apply."
