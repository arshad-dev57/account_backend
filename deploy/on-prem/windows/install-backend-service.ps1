#Requires -Version 5.1
<#
.SYNOPSIS
  Install Bisonstechs backend as a PM2-managed Windows production service.

.DESCRIPTION
  - Installs production npm dependencies (no devDependencies)
  - Runs prisma generate (+ optional migrate deploy)
  - Starts the backend with PM2 (auto-restart on crash)
  - Registers PM2 to resurrect processes on Windows login/boot

  Run from an elevated (Administrator) PowerShell for the startup registration step.
  Secrets stay in .env only — never commit that file.

.PARAMETER BackendRoot
  Path to account_backend folder. Defaults to three levels above this script.

.PARAMETER SkipMigrate
  Skip `prisma migrate deploy` (use when DB schema is already applied).

.PARAMETER SkipStartup
  Skip pm2-windows-startup registration (use for testing only).
#>
[CmdletBinding()]
param(
  [string]$BackendRoot = '',
  [switch]$SkipMigrate,
  [switch]$SkipStartup
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

if (-not $BackendRoot) {
  $BackendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}

$EcosystemFile = Join-Path $PSScriptRoot 'ecosystem.config.cjs'
$LogsDir = Join-Path $PSScriptRoot 'logs'

Write-Host 'Bisonstechs — Backend Windows Service Install' -ForegroundColor Green
Write-Host "Backend root: $BackendRoot"

if (-not (Test-Path (Join-Path $BackendRoot 'server.js'))) {
  throw "server.js not found in $BackendRoot — check -BackendRoot"
}

if (-not (Test-Path (Join-Path $BackendRoot '.env'))) {
  throw @"
.env not found in $BackendRoot
Copy .env.onprem.example to .env, set DATABASE_URL, JWT_SECRET, and Cloudinary keys, then re-run.
"@
}

# Node.js
Write-Step 'Checking Node.js'
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  throw 'Node.js is not installed. Install Node.js 20 LTS from https://nodejs.org/ and re-run.'
}
$nodeVersion = node -v
Write-Host "Node.js $nodeVersion"

# Production dependencies
Write-Step 'Installing npm dependencies (production)'
Push-Location $BackendRoot
try {
  npm ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }

  Write-Step 'Prisma generate'
  npx prisma generate
  if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }

  if (-not $SkipMigrate) {
    Write-Step 'Prisma migrate deploy (local database only)'
    npx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed — check DATABASE_URL in .env" }
  } else {
    Write-Host 'Skipped prisma migrate deploy (-SkipMigrate)' -ForegroundColor Yellow
  }
} finally {
  Pop-Location
}

# Logs directory
if (-not (Test-Path $LogsDir)) {
  New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

# PM2
Write-Step 'Installing PM2 and pm2-windows-startup (global)'
npm install -g pm2 pm2-windows-startup
if ($LASTEXITCODE -ne 0) { throw 'Failed to install pm2 globally' }

Write-Step 'Starting backend with PM2'
pm2 delete bisonstechs-backend 2>$null
pm2 start $EcosystemFile --update-env
if ($LASTEXITCODE -ne 0) { throw 'pm2 start failed' }

pm2 save
if ($LASTEXITCODE -ne 0) { throw 'pm2 save failed' }

if (-not $SkipStartup) {
  Write-Step 'Registering PM2 Windows startup (requires Administrator)'
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
  if (-not $isAdmin) {
    Write-Warning @"
Not running as Administrator — PM2 will NOT auto-start on Windows reboot.
Re-run this script in an elevated PowerShell, or run manually:
  pm2-startup install
  pm2 save
"@
  } else {
    pm2-startup install
    if ($LASTEXITCODE -ne 0) { throw 'pm2-startup install failed' }
    pm2 save
  }
}

Write-Step 'Done'
pm2 status
Write-Host @"

Backend is running under PM2.

Quick checks:
  curl http://127.0.0.1:5000/
  curl http://127.0.0.1:5000/api/health/prisma

Control:
  pm2 status
  pm2 logs bisonstechs-backend
  pm2 restart bisonstechs-backend

Or use: deploy\on-prem\windows\service-control.ps1 -Action status

Logs: deploy\on-prem\windows\logs\out.log and error.log
"@ -ForegroundColor Green
