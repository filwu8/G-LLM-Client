# Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1
param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'workspace-appcontainer.cs')
  $launch = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
  $env:TEMP = [string]$launch.scratch
  $env:TMP = [string]$launch.scratch
  $code = [GllmAppContainer]::Run([string]$launch.executable, [string[]]$launch.args, [string]$launch.cwd, [string]$launch.work, [string]$launch.scratch, [bool]$launch.network, [int]$launch.timeoutMs)
  exit $code
} catch {
  [Console]::Error.WriteLine('AppContainer launch failed; no host fallback: ' + $_.Exception.Message)
  exit 125
}
