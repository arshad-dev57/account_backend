#Requires -Version 5.1
<#
.SYNOPSIS
  Stop and remove the Bisonstechs backend from PM2 (Windows on-prem).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

Write-Host 'Bisonstechs — Backend Windows Service Uninstall' -ForegroundColor Yellow

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2) {
  Write-Host 'PM2 is not installed — nothing to remove.' -ForegroundColor Gray
  exit 0
}

pm2 delete bisonstechs-backend 2>$null
pm2 save

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if ($isAdmin) {
  $startup = Get-Command pm2-startup -ErrorAction SilentlyContinue
  if ($startup) {
    pm2-startup uninstall 2>$null
  }
}

Write-Host 'Backend removed from PM2. .env and database were not deleted.' -ForegroundColor Green
