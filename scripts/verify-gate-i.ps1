param(
  [switch]$ApplyMigration,
  [switch]$RequireLiveGateI,
  [switch]$RequireProductionEvidence,
  [string]$ApiOrigin,
  [string]$WebOrigin
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$api = Join-Path $project "apps\api"
$web = Join-Path $project "apps\web"

function Check([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE." }
}
function Require-Value([string]$name) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name is required for Gate I production evidence."
  }
}

if ($RequireLiveGateI) {
  foreach ($name in @(
    "E2E_CASE_USER_EMAIL",
    "E2E_CASE_USER_PASSWORD",
    "E2E_CASE_USER_TOTP_SECRET",
    "INTEGRATION_SIGNING_MASTER_SECRET"
  )) { Require-Value $name }
}

Set-Location $api
npx prettier --write "src/operational-readiness/**/*.ts" "src/config/env.validation*.ts"
Check "API formatting"
npm test -- --runInBand
Check "API tests"
npm run build
Check "API build"

Set-Location $web
npm run lint
Check "Web lint"
$previousNodeEnvironment = $env:NODE_ENV
try {
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  npm run build
  Check "Web build"
} finally {
  if ($null -eq $previousNodeEnvironment) {
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  } else {
    $env:NODE_ENV = $previousNodeEnvironment
  }
}

Set-Location $project
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  if ($RequireProductionEvidence) {
    docker compose -f ".\deploy\compose.production.yml" config --quiet
  } else {
    docker compose -f ".\deploy\compose.production.yml" config --no-interpolate --quiet
  }
  Check "Production compose validation"
} elseif ($RequireProductionEvidence) {
  throw "Docker is required for production image and compose evidence."
} else {
  Write-Warning "Docker unavailable; production image evidence remains outstanding."
}

Set-Location $project
npx supabase db push --dry-run --linked
Check "Migration dry-run"
if ($ApplyMigration) {
  npx supabase db push --linked
  Check "Gate I migration"
} elseif ($RequireLiveGateI -or $RequireProductionEvidence) {
  throw "ApplyMigration is required for live Gate I verification."
}

if ($RequireLiveGateI) {
  Set-Location $web
  $output = @()
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & npx playwright test `
      e2e/auth-enquiries.spec.ts `
      e2e/case-operations.spec.ts `
      e2e/automation-control.spec.ts `
      e2e/communications.spec.ts `
      e2e/client-portal.spec.ts `
      e2e/finance.spec.ts `
      e2e/integrations-command-centre.spec.ts `
      e2e/service-lifecycle-end-to-end.spec.ts `
      e2e/universal-intake.spec.ts `
      --project=chromium --workers=1 2>&1 | Tee-Object -Variable output
    $browserExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($browserExitCode -ne 0) { throw "Gate I live regression failed." }
  if (($output | Out-String) -match '(?im)^\s*\d+\s+skipped(?:\s|$)') {
    throw "Live Gate I acceptance cannot contain skipped tests."
  }
}

if ($RequireProductionEvidence) {
  foreach ($name in @(
    "OPERATIONS_HEALTH_TOKEN",
    "BACKUP_RESTORE_EVIDENCE_AT",
    "INCIDENT_RESPONSE_EMAIL",
    "E2E_CASE_USER_EMAIL",
    "E2E_CASE_USER_PASSWORD",
    "E2E_CASE_USER_TOTP_SECRET"
  )) { Require-Value $name }
  if (-not $ApiOrigin -or -not $WebOrigin) {
    throw "ApiOrigin and WebOrigin are required for production evidence."
  }
  & ".\scripts\verify-production-endpoints.ps1" `
    -ApiOrigin $ApiOrigin -WebOrigin $WebOrigin `
    -OperationsToken $env:OPERATIONS_HEALTH_TOKEN
  Check "Production endpoint evidence"
}

Write-Output "Gate I verification completed successfully."
