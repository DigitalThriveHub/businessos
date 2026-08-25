param(
  [Parameter(Mandatory = $true)][string]$ApiOrigin,
  [Parameter(Mandatory = $true)][string]$WebOrigin,
  [Parameter(Mandatory = $true)][string]$OperationsToken
)

$ErrorActionPreference = "Stop"

function Assert-HttpsOrigin([string]$value, [string]$name) {
  $uri = [Uri]$value
  if ($uri.Scheme -ne "https" -or $uri.PathAndQuery -ne "/") {
    throw "$name must be an HTTPS origin without a path or query."
  }
  return $value.TrimEnd("/")
}

$api = Assert-HttpsOrigin $ApiOrigin "ApiOrigin"
$web = Assert-HttpsOrigin $WebOrigin "WebOrigin"

$live = Invoke-RestMethod -Uri "$api/api/v1/health/live" -Method Get
if ($live.status -ne "ok") { throw "API liveness failed." }

$ready = Invoke-RestMethod -Uri "$api/api/v1/health/ready" -Method Get
if ($ready.status -ne "ready" -or $ready.release -eq "development") {
  throw "API readiness or release identity failed."
}

$diagnostics = Invoke-RestMethod `
  -Uri "$api/api/v1/health/diagnostics" `
  -Headers @{ "x-operations-token" = $OperationsToken } `
  -Method Get
if ($diagnostics.status -ne "operational") {
  $diagnostics | ConvertTo-Json -Depth 8
  throw "Production diagnostics are degraded."
}

$login = Invoke-WebRequest -Uri "$web/login" -Method Get
if ($login.StatusCode -ne 200) { throw "Web login probe failed." }
foreach ($header in @(
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Content-Security-Policy",
  "Permissions-Policy"
)) {
  if (-not $login.Headers[$header]) { throw "Required web security header $header is missing." }
}

node "$PSScriptRoot\gate-i-capacity-smoke.mjs" "$api/api/v1/health/ready"
if ($LASTEXITCODE -ne 0) { throw "Production capacity smoke failed." }

Write-Output "Production endpoints, release identity, workers, queues and recovery evidence are operational."
