param(
  [switch]$ApplyMigration
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$api = Join-Path $project "apps\api"
$web = Join-Path $project "apps\web"
$runtimeMigration = Join-Path $project (
  "supabase\migrations\20260825133000_gate_l_runtime_enum_casts.sql"
)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
if (Get-Command chcp.com -ErrorAction SilentlyContinue) { chcp.com 65001 > $null }

function Check([string]$step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$step failed with exit code $LASTEXITCODE."
  }
}

if (-not (Test-Path -LiteralPath $runtimeMigration -PathType Leaf)) {
  throw "Gate L runtime enum repair migration is missing."
}

$runtimeSql = Get-Content -LiteralPath $runtimeMigration -Raw
foreach ($required in @(
  "::public.communication_message_status",
  "::public.communication_delivery_event_type",
  "::public.communication_reminder_status",
  "private.create_staff_communication_message",
  "private.materialise_due_communication_reminders"
)) {
  if (-not $runtimeSql.Contains($required)) {
    throw "Gate L runtime migration is missing $required."
  }
}
if (-not $runtimeSql.TrimEnd().EndsWith("COMMIT;")) {
  throw "Gate L runtime migration is not transactionally closed."
}

Write-Output "Checking Gate L runtime migration contract..."
Set-Location $api
npx prettier --check "src/communications/gate-l-migration.contract.spec.ts"
Check "Gate L migration contract formatting"
npm test -- --runInBand
Check "Gate L API regression"

Write-Output "Checking Gate L browser QA sources..."
Set-Location $web
npx eslint `
  "e2e/auth-enquiries.spec.ts" `
  "e2e/profile.spec.ts" `
  "e2e/gate-l-live-operations.spec.ts" `
  "playwright.config.ts"
Check "Gate L browser QA lint"
npx playwright test --project=chromium --list
Check "Gate L browser QA compilation"

Write-Output "Checking linked database migration plan..."
Set-Location $project
npx supabase db push --dry-run --linked
Check "Gate L runtime migration dry-run"

if (-not $ApplyMigration) {
  Write-Output "Gate L QA source checks passed. Runtime migration and browser execution were not run."
  exit 0
}

npx supabase db push --linked --yes
Check "Gate L runtime migration"
$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  $migrationList = @(& npx supabase migration list --linked 2>&1)
  $migrationListExitCode = $LASTEXITCODE
}
finally {
  $ErrorActionPreference = $previousErrorActionPreference
}

$migrationList | ForEach-Object { Write-Output "$_" }

if ($migrationListExitCode -ne 0) {
  throw "Gate L runtime migration listing failed with exit code $migrationListExitCode."
}
if (($migrationList -join "`n") -notmatch "20260825133000") {
  throw "Remote migration 20260825133000 was not confirmed."
}

Write-Output "Running serial non-provider browser regression..."
Set-Location $web
$previousGateK = $env:REQUIRE_LIVE_GATE_K
$previousGateL = $env:REQUIRE_LIVE_GATE_L
try {
  $env:REQUIRE_LIVE_GATE_K = "0"
  $env:REQUIRE_LIVE_GATE_L = "0"
  npx playwright test --project=chromium --workers=1
  Check "Gate L non-provider browser regression"
} finally {
  if ($null -eq $previousGateK) {
    Remove-Item Env:REQUIRE_LIVE_GATE_K -ErrorAction SilentlyContinue
  } else {
    $env:REQUIRE_LIVE_GATE_K = $previousGateK
  }
  if ($null -eq $previousGateL) {
    Remove-Item Env:REQUIRE_LIVE_GATE_L -ErrorAction SilentlyContinue
  } else {
    $env:REQUIRE_LIVE_GATE_L = $previousGateL
  }
}

Write-Output "Gate L QA REGRESSION PASSED. Live OpenAI and external communications acceptance remain intentionally deferred."
