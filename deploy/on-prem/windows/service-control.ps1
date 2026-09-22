#Requires -Version 5.1
<#
.SYNOPSIS
  Start, stop, restart, or inspect the Bisonstechs backend PM2 process.

.PARAMETER Action
  start | stop | restart | status | logs

.EXAMPLE
  .\service-control.ps1 -Action status
  .\service-control.ps1 -Action logs
  .\service-control.ps1 -Action restart
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
  [string]$Action,

  [string]$BackendRoot = ''
)

$ErrorActionPreference = 'Stop'
$AppName = 'bisonstechs-backend'

if (-not $BackendRoot) {
  $BackendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}

$EcosystemFile = Join-Path $PSScriptRoot 'ecosystem.config.cjs'

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2) {
  throw 'PM2 is not installed. Run install-backend-service.ps1 first.'
}

switch ($Action) {
  'start' {
    pm2 start $EcosystemFile --update-env
  }
  'stop' {
    pm2 stop $AppName
  }
  'restart' {
    pm2 restart $AppName --update-env
  }
  'status' {
    pm2 status $AppName
    pm2 info $AppName
  }
  'logs' {
    pm2 logs $AppName --lines 100
  }
}

if ($LASTEXITCODE -ne 0 -and $Action -ne 'logs') {
  throw "pm2 $Action failed with exit code $LASTEXITCODE"
}
