param(
  [switch]$ApplyMigration,
  [switch]$FreeMode,
  [switch]$RequireProductionEvidence,
  [string]$ApiOrigin,
  [string]$WebOrigin
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$api = Join-Path $project "apps\api"
$web = Join-Path $project "apps\web"
$apiEnvironment = Join-Path $api ".env"
$webEnvironment = Join-Path $web ".env.local"
$migrationVersion = "20260825180000"
$migration = Join-Path $project "supabase\migrations\${migrationVersion}_gate_n_uk_compliance_production_assurance.sql"
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

function Import-DotEnvValue([string]$path, [string]$name) {
  if (-not [string]::IsNullOrWhiteSpace(
    [Environment]::GetEnvironmentVariable($name)
  )) { return }
  if (-not (Test-Path -LiteralPath $path)) { return }
  $pattern = "^\s*$([regex]::Escape($name))\s*="
  $line = Get-Content -LiteralPath $path |
    Where-Object { $_ -match $pattern } |
    Select-Object -Last 1
  if (-not $line) { return }
  $value = $line.Substring($line.IndexOf("=") + 1).Trim()
  if (
    $value.Length -ge 2 -and
    (($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'")))
  ) { $value = $value.Substring(1, $value.Length - 2) }
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Require-Value([string]$name, [string]$purpose) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$name is required for $purpose."
  }
  if ($value -match '(?i)(replace|changeme|your-|example-value)') {
    throw "$name still contains a placeholder value."
  }
}

function Normalise-HttpsOrigin([string]$value, [string]$name) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$name is required for production evidence verification."
  }
  try { $uri = [Uri]$value } catch { throw "$name is not a valid URI." }
  if (
    $uri.Scheme -ne "https" -or
    -not [string]::IsNullOrWhiteSpace($uri.Query) -or
    -not [string]::IsNullOrWhiteSpace($uri.Fragment) -or
    $uri.AbsolutePath -ne "/"
  ) {
    throw "$name must be an HTTPS origin without a path, query or fragment."
  }
  return $value.TrimEnd("/")
}

function Assert-PortsAvailable {
  if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
    return
  }
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(3000, 4000) })
  if ($listeners.Count -gt 0) {
    $details = ($listeners | ForEach-Object {
      "port $($_.LocalPort) (PID $($_.OwningProcess))"
    }) -join ", "
    throw "Close manually running API/web terminals before browser QA. Active: $details"
  }
}

if ($FreeMode -and $RequireProductionEvidence) {
  throw "FreeMode and RequireProductionEvidence are mutually exclusive."
}
if ($RequireProductionEvidence -and -not $ApplyMigration) {
  throw "RequireProductionEvidence also requires ApplyMigration."
}
if ($RequireProductionEvidence) {
  $ApiOrigin = Normalise-HttpsOrigin $ApiOrigin "ApiOrigin"
  $WebOrigin = Normalise-HttpsOrigin $WebOrigin "WebOrigin"
}

foreach ($name in @(
  "OPENAI_AGENT_ENABLED", "OPENAI_API_KEY", "OPENAI_AGENT_MODEL",
  "GATE_L_LIVE_ENABLED", "GATE_L_SYNC_ENABLED",
  "GATE_L_PROVIDER_SECRETS_JSON", "DOCUMENT_SCANNER_ENABLED",
  "DOCUMENT_INTELLIGENCE_ENABLED", "DOCUMENT_INTELLIGENCE_MODEL",
  "OPERATIONS_HEALTH_TOKEN", "BACKUP_RESTORE_EVIDENCE_AT"
)) { Import-DotEnvValue $apiEnvironment $name }
foreach ($name in @(
  "E2E_CASE_USER_EMAIL", "E2E_CASE_USER_PASSWORD",
  "E2E_CASE_USER_TOTP_SECRET", "E2E_MFA_USER_EMAIL",
  "E2E_MFA_USER_PASSWORD", "E2E_GATE_L_RECIPIENT_EMAIL",
  "E2E_GATE_L_RECIPIENT_PHONE", "E2E_GATE_M_DOCUMENT_TITLE",
  "E2E_GATE_N_RELEASE_REFERENCE", "E2E_GATE_N_CHANGE_REFERENCE"
)) { Import-DotEnvValue $webEnvironment $name }

foreach ($name in @(
  "E2E_CASE_USER_EMAIL", "E2E_CASE_USER_PASSWORD", "E2E_CASE_USER_TOTP_SECRET"
)) { Require-Value $name "Gate N AAL2 browser regression" }

if (-not (Test-Path -LiteralPath $migration)) {
  throw "Gate N migration is missing: $migration"
}
$sql = Get-Content -LiteralPath $migration -Raw
$functionCount = [regex]::Matches(
  $sql, '(?m)^CREATE OR REPLACE FUNCTION '
).Count
$closureCount = [regex]::Matches($sql, '(?m)^\$function\$;').Count
$validEndCount = [regex]::Matches(
  $sql, '(?m)^END;\r?\n\$function\$;'
).Count
$brokenEndCount = [regex]::Matches(
  $sql, '(?m)^END\r?\n\$function\$;'
).Count
if (
  $functionCount -ne 22 -or $closureCount -ne 22 -or
  $validEndCount -ne 19 -or $brokenEndCount -ne 0 -or
  -not $sql.TrimEnd().EndsWith("COMMIT;")
) {
  throw "Gate N migration function structure is invalid; nothing will be applied."
}
foreach ($requiredSql in @(
  "FORCE ROW LEVEL SECURITY", "interval '1 month'", "interval '2 months'",
  "interval '72 hours'", "extend_data_subject_request",
  "notificationReferenceRecorded",
  "build_data_subject_export_candidate", "find_active_legal_hold",
  "destructiveActionExecutedByThisFunction", "review_assurance_evidence",
  "Evidence must be reviewed by a different AAL2 user",
  "get_production_release_blockers", "SEGREGATION_OF_DUTIES",
  "security.penetration_test", "backup.restore", "acceptance.uk_pilot",
  "Mandatory assurance evidence exceeds its maximum validity window",
  "Production release is blocked by unresolved controls"
)) {
  if ($sql -notmatch [regex]::Escape($requiredSql)) {
    throw "Gate N migration is missing required control: $requiredSql"
  }
}

Set-Location $project
if (
  (Get-Command git -ErrorAction SilentlyContinue) -and
  (Test-Path -LiteralPath (Join-Path $project ".git"))
) {
  $tracked = @(git ls-files)
  Check "Tracked-file inspection"
  $unsafe = @($tracked | Where-Object {
    ($_ -match '(^|/)\.env($|\.)' -and
      $_ -notmatch '\.(example|sample|template)$') -or
    $_ -match '\.(pem|key|pfx|p12)$' -or
    $_ -match '(^|/)(secrets?|credentials?)(/|$)' -or
    $_ -match '(storage-state|storageState|service-account).*\.json$'
  })
  if ($unsafe.Count -gt 0) {
    $unsafe | ForEach-Object { Write-Error "Tracked secret candidate: $_" }
    throw "Potential secret files are tracked. Remove them before verification."
  }
}

Write-Output "Executing all database migrations in an isolated PostgreSQL-compatible engine..."
node ".\scripts\test-migrations-pglite.mjs"
Check "Ordered migration execution"

Write-Output "Checking API format, lint, schema, tests and production build..."
Set-Location $api
npx prettier --check "src/**/*.ts" "test/**/*.ts" "package.json"
Check "API formatting"
npx eslint "{src,test}/**/*.ts"
Check "API lint"
npx prisma validate --schema ".\prisma\schema.prisma"
Check "Prisma validation"
npx prisma generate --schema ".\prisma\schema.prisma"
Check "Prisma generation"
npm test -- --runInBand
Check "API tests"
npm run build
Check "API build"
if (-not (Test-Path -LiteralPath (Join-Path $api "dist\main.js"))) {
  throw "API build did not create dist\main.js."
}

Write-Output "Checking web lint, production build and 25 browser scenarios..."
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
  } else { $env:NODE_ENV = $previousNodeEnvironment }
}
npx playwright test --list
Check "Browser test compilation"

Set-Location $project
npx supabase db push --dry-run --linked
Check "Migration dry-run"
if ($ApplyMigration) {
  npx supabase db push --linked --yes
  Check "Gate N migration"
  $migrationList = npx supabase migration list --linked | Out-String
  Check "Migration list"
  if ($migrationList -notmatch $migrationVersion) {
    throw "Remote migration list does not contain Gate N."
  }
}

if ($RequireProductionEvidence) {
  foreach ($name in @(
    "E2E_MFA_USER_EMAIL", "E2E_MFA_USER_PASSWORD",
    "OPENAI_API_KEY", "OPENAI_AGENT_MODEL",
    "GATE_L_PROVIDER_SECRETS_JSON", "E2E_GATE_L_RECIPIENT_EMAIL",
    "E2E_GATE_L_RECIPIENT_PHONE", "E2E_GATE_M_DOCUMENT_TITLE",
    "E2E_GATE_N_RELEASE_REFERENCE", "OPERATIONS_HEALTH_TOKEN",
    "BACKUP_RESTORE_EVIDENCE_AT"
  )) { Require-Value $name "production evidence verification" }
  foreach ($setting in @(
    @("OPENAI_AGENT_ENABLED", "true"),
    @("GATE_L_LIVE_ENABLED", "true"),
    @("GATE_L_SYNC_ENABLED", "true"),
    @("DOCUMENT_SCANNER_ENABLED", "true"),
    @("DOCUMENT_INTELLIGENCE_ENABLED", "true")
  )) {
    if ([Environment]::GetEnvironmentVariable($setting[0]) -ne $setting[1]) {
      throw "$($setting[0]) must be $($setting[1]) for production evidence."
    }
  }
}

Assert-PortsAvailable
Set-Location $web
$overrides = @{}
if ($FreeMode) {
  $overrides = @{
    REQUIRE_LIVE_GATE_K = "0"
    REQUIRE_LIVE_GATE_L = "0"
    REQUIRE_LIVE_GATE_M = "0"
    REQUIRE_LIVE_GATE_N = "0"
    OPENAI_AGENT_ENABLED = "false"
    DOCUMENT_INTELLIGENCE_ENABLED = "false"
    GATE_L_LIVE_ENABLED = "false"
    GATE_L_SYNC_ENABLED = "false"
    COMMUNICATION_DELIVERY_ENABLED = "false"
  }
} elseif ($RequireProductionEvidence) {
  $overrides = @{
    REQUIRE_LIVE_GATE_K = "1"
    REQUIRE_LIVE_GATE_L = "1"
    REQUIRE_LIVE_GATE_M = "1"
    REQUIRE_LIVE_GATE_N = "1"
    PLAYWRIGHT_BASE_URL = $WebOrigin.TrimEnd("/")
    PLAYWRIGHT_API_BASE_URL = $ApiOrigin.TrimEnd("/")
  }
}
$previousValues = @{}
$browserOutput = @()
$browserExitCode = 1
try {
  foreach ($entry in $overrides.GetEnumerator()) {
    $previousValues[$entry.Key] =
      [Environment]::GetEnvironmentVariable($entry.Key)
    [Environment]::SetEnvironmentVariable(
      $entry.Key, $entry.Value, "Process"
    )
  }
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & npx playwright test --project=chromium --workers=1 2>&1 |
      Tee-Object -Variable browserOutput
    $browserExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorAction }
} finally {
  foreach ($entry in $overrides.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable(
      $entry.Key, $previousValues[$entry.Key], "Process"
    )
  }
}
if ($browserExitCode -ne 0) { throw "Full browser regression failed." }
$browserText = ($browserOutput | ForEach-Object { $_.ToString() }) -join "`n"
$passedMatch = [regex]::Match($browserText, '(?im)^\s*(\d+)\s+passed(?:\s|$)')
$skippedMatch = [regex]::Match($browserText, '(?im)^\s*(\d+)\s+skipped(?:\s|$)')
$passed = if ($passedMatch.Success) { [int]$passedMatch.Groups[1].Value } else { 0 }
$skipped = if ($skippedMatch.Success) { [int]$skippedMatch.Groups[1].Value } else { 0 }
if ($passed + $skipped -ne 25) {
  throw "Expected 25 browser scenarios but confirmed $passed passed and $skipped skipped."
}
if ($FreeMode) {
  $mfaConfigured = -not [string]::IsNullOrWhiteSpace($env:E2E_MFA_USER_EMAIL) -and
    -not [string]::IsNullOrWhiteSpace($env:E2E_MFA_USER_PASSWORD)
  $expectedSkipped = if ($mfaConfigured) { 4 } else { 5 }
  if ($skipped -ne $expectedSkipped) {
    throw "Free mode permits only four provider skips and the optional MFA-fixture skip; found $skipped."
  }
}
if ($RequireProductionEvidence -and $skipped -ne 0) {
  throw "Production evidence verification cannot contain skipped browser scenarios."
}

if ($RequireProductionEvidence) {
  Set-Location $project
  & ".\scripts\verify-production-endpoints.ps1" `
    -ApiOrigin $ApiOrigin -WebOrigin $WebOrigin `
    -OperationsToken $env:OPERATIONS_HEALTH_TOKEN
  Check "Production endpoint evidence"
}

Write-Output "Gate N verification succeeded: API, schema, all migrations, builds and $passed browser scenarios passed; $skipped intentional scenarios skipped."
if (-not $RequireProductionEvidence) {
  Write-Warning "Automated verification is complete. Production approval remains blocked until all mandatory evidence is independently reviewed in Assurance centre."
}
