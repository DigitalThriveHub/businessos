param(
  [switch]$ApplyMigration,
  [switch]$RequireLiveGateK,
  [switch]$FreeMode
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
  if ($LASTEXITCODE -ne 0) {
    throw "$step failed with exit code $LASTEXITCODE."
  }
}

function Require-Value([string]$name) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$name is required for the live Gate K acceptance run."
  }
  if ($value -match '(?i)(replace|example|your-|changeme)') {
    throw "$name still contains a placeholder value."
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
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

if ($RequireLiveGateK -and -not $ApplyMigration) {
  throw "RequireLiveGateK also requires ApplyMigration."
}
if ($RequireLiveGateK -and $FreeMode) {
  throw "FreeMode and RequireLiveGateK are mutually exclusive."
}

$apiEnvironment = Join-Path $api ".env"
$webEnvironment = Join-Path $web ".env.local"
foreach ($name in @(
  "OPENAI_AGENT_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_AGENT_MODEL",
  "INTEGRATION_SIGNING_MASTER_SECRET"
)) {
  Import-DotEnvValue $apiEnvironment $name
}
foreach ($name in @(
  "E2E_CASE_USER_EMAIL",
  "E2E_CASE_USER_PASSWORD",
  "E2E_CASE_USER_TOTP_SECRET"
)) {
  Import-DotEnvValue $webEnvironment $name
}

if ($RequireLiveGateK) {
  foreach ($name in @(
    "OPENAI_AGENT_ENABLED",
    "OPENAI_API_KEY",
    "OPENAI_AGENT_MODEL",
    "INTEGRATION_SIGNING_MASTER_SECRET",
    "E2E_CASE_USER_EMAIL",
    "E2E_CASE_USER_PASSWORD",
    "E2E_CASE_USER_TOTP_SECRET"
  )) { Require-Value $name }

  if ($env:OPENAI_AGENT_ENABLED -ne "true") {
    throw "OPENAI_AGENT_ENABLED must be true for live Gate K acceptance."
  }

  if ($env:OPENAI_API_KEY -notmatch '^sk-[A-Za-z0-9_-]{20,}$') {
    throw "OPENAI_API_KEY does not look like a valid server-side project key."
  }
  if ($env:OPENAI_AGENT_MODEL -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw "OPENAI_AGENT_MODEL is invalid."
  }
}

if ($FreeMode -and $env:OPENAI_AGENT_ENABLED -eq "true") {
  throw "FreeMode requires OPENAI_AGENT_ENABLED=false (or omitted) in apps\api\.env."
}

Set-Location $project
if (
  (Get-Command git -ErrorAction SilentlyContinue) -and
  (Test-Path -LiteralPath (Join-Path $project ".git"))
) {
  $tracked = @(git ls-files)
  Check "Tracked-file inspection"
  $unsafe = @(
    $tracked | Where-Object {
      ($_ -match '(^|/)\.env($|\.)' -and
        $_ -notmatch '\.(example|sample|template)$') -or
      $_ -match '\.(pem|key|pfx|p12)$' -or
      $_ -match '(^|/)(secrets?|credentials?)(/|$)' -or
      $_ -match '(storage-state|storageState|service-account).*\.json$'
    }
  )
  if ($unsafe.Count -gt 0) {
    $unsafe | ForEach-Object { Write-Error "Tracked secret candidate: $_" }
    throw "Potential secret files are tracked. Remove them before Gate K verification."
  }
}

Set-Location $api
npx prettier --check `
  "src/my-ai/**/*.ts" `
  "src/config/env.validation*.ts" `
  "src/rbac/default-*.ts" `
  "src/app.module.ts" `
  "eslint.config.mjs" `
  "tsconfig.build.json"
Check "Gate K API formatting"
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
  throw "API build did not create dist\main.js; production start would fail."
}

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
npx playwright test `
  e2e/gate-k-governed-personal-ai.spec.ts `
  --project=chromium --list
Check "Gate K browser compilation"

if ($RequireLiveGateK) {
  $staticPath = Join-Path $web ".next\static"
  $secretLeak = Get-ChildItem -LiteralPath $staticPath -Recurse -File |
    Select-String -SimpleMatch $env:OPENAI_API_KEY -Quiet
  if ($secretLeak) {
    throw "OPENAI_API_KEY was found in a browser-static build artifact."
  }
}

Set-Location $project
npx supabase db push --dry-run --linked
Check "Migration dry-run"
if (-not $ApplyMigration) {
  if ($FreeMode) {
    Write-Output "Gate K free-mode code gates passed. No AI provider call was made; migration was not applied."
  } else {
    Write-Output "Gate K code gates passed; migration and live acceptance were not run."
  }
  exit 0
}

npx supabase db push --linked
Check "Gate K migration"

if (-not $RequireLiveGateK) {
  if ($FreeMode) {
    Write-Output "Gate K free-mode verification completed and migration applied. No AI provider call was made."
  } else {
    Write-Output "Gate K migration applied; real-provider browser acceptance was not required."
  }
  exit 0
}

Set-Location $web
$previousRequireLive = $env:REQUIRE_LIVE_GATE_K
$output = @()
$previousErrorAction = $ErrorActionPreference
try {
  $env:REQUIRE_LIVE_GATE_K = "1"
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
    e2e/pilot-readiness.spec.ts `
    e2e/gate-k-governed-personal-ai.spec.ts `
    --project=chromium --workers=1 2>&1 | Tee-Object -Variable output
  $browserExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorAction
  if ($null -eq $previousRequireLive) {
    Remove-Item Env:REQUIRE_LIVE_GATE_K -ErrorAction SilentlyContinue
  } else {
    $env:REQUIRE_LIVE_GATE_K = $previousRequireLive
  }
}

if ($browserExitCode -ne 0) {
  throw "Gate K real-provider and critical browser regression failed."
}
if (($output | Out-String) -match '(?im)^\s*\d+\s+skipped(?:\s|$)') {
  throw "Live Gate K acceptance cannot contain skipped tests."
}

Write-Output "Gate K verification completed successfully with live provider evidence."
