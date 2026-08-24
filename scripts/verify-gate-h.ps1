param(
  [switch]$ApplyMigration,
  [switch]$RequireLiveGateH,
  [switch]$RequireProductionEvidence
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$api = Join-Path $project "apps\api"
$web = Join-Path $project "apps\web"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
if (Get-Command chcp.com -ErrorAction SilentlyContinue) { chcp.com 65001 > $null }

function Check([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE." }
}

function Require-Value([string]$name) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name is required for the live Gate H acceptance run."
  }
}

if ($RequireLiveGateH) {
  Require-Value "E2E_CASE_USER_EMAIL"
  Require-Value "E2E_CASE_USER_PASSWORD"
  Require-Value "E2E_CASE_USER_TOTP_SECRET"
  Require-Value "INTEGRATION_SIGNING_MASTER_SECRET"
}

Set-Location $project
node --test ".\connectors\connectors.test.mjs"
Check "Connector contract tests"

$php = Get-Command php -ErrorAction SilentlyContinue
if ($php) {
  php -l ".\connectors\php\businessos-intake.php"
  Check "PHP connector syntax"
  php -l ".\connectors\wordpress\businessos-intake.php"
  Check "WordPress connector syntax"
} elseif ($RequireProductionEvidence) {
  throw "PHP CLI is required for production connector evidence."
} else {
  Write-Warning "PHP CLI unavailable; staging must run php -l before WordPress activation."
}

Set-Location $api
npx prettier --write `
  "src/integrations/**/*.ts" `
  "src/communications/**/*.ts"
Check "API formatting"
npx prisma format
Check "Prisma format"
npx prisma validate
Check "Prisma validation"
npx prisma generate
Check "Prisma generation"
npm test -- --runInBand
Check "API tests"
npm run build
Check "API build"

Set-Location $web
npm run lint
Check "Web lint"
npm run build
Check "Web build"
npx playwright test `
  e2e/integrations-command-centre.spec.ts `
  e2e/universal-intake.spec.ts `
  --project=chromium `
  --list
Check "Gate H browser compilation"

if ($RequireProductionEvidence) {
  foreach ($name in @(
    "GATE_H_WORDPRESS_ACCEPTANCE_AT",
    "GATE_H_GOOGLE_FORMS_ACCEPTANCE_AT",
    "GATE_H_META_LEAD_ADS_ACCEPTANCE_AT",
    "GATE_H_PUBLIC_FORM_ACCEPTANCE_AT",
    "GATE_H_GENERIC_CONNECTOR_ACCEPTANCE_AT"
  )) { Require-Value $name }
}

Set-Location $project
npx supabase db push --dry-run --linked
Check "Migration dry-run"
if (-not $ApplyMigration) {
  Write-Output "Gate H code gates passed; migration was not applied."
  exit 0
}
npx supabase db push --linked
Check "Gate H migration"

Set-Location $web
$output = @()
$previous = $ErrorActionPreference
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
    e2e/service-lifecycle.spec.ts `
    e2e/service-lifecycle-end-to-end.spec.ts `
    e2e/universal-intake.spec.ts `
    --project=chromium `
    --workers=1 2>&1 | Tee-Object -Variable output
  $code = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previous
}
if ($code -ne 0) { throw "Gate H critical browser tests failed." }
if ($RequireLiveGateH -and (($output | Out-String) -match '(?im)^\s*\d+\s+skipped(?:\s|$)')) {
  throw "Live Gate H acceptance cannot contain skipped tests."
}
Write-Output "Gate H verification completed successfully."
