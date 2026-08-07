$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Port = 4188
$Url = "http://127.0.0.1:$Port"
$NodeCandidates = @(
  "$env:ProgramFiles\nodejs\node.exe",
  "${env:ProgramFiles(x86)}\nodejs\node.exe",
  "node.exe"
) | Where-Object { $_ -and (Get-Command $_ -ErrorAction SilentlyContinue) }

function Test-OrchestratorDashboard {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

if (-not (Test-OrchestratorDashboard)) {
  if (-not $NodeCandidates.Count) {
    throw "Node.js introuvable. Installe Node.js ou lance depuis un terminal ou Node est disponible."
  }

  $node = $NodeCandidates[0].Source
  if (-not $node) { $node = [string]$NodeCandidates[0] }

  Start-Process `
    -FilePath $node `
    -ArgumentList "dashboard\server.mjs" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds(12)
  while ((Get-Date) -lt $deadline) {
    if (Test-OrchestratorDashboard) { break }
    Start-Sleep -Milliseconds 500
  }
}

Start-Process $Url
