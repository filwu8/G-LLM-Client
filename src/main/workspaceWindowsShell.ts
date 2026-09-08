/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
export function windowsBatchScript(code: string): string {
  return '@echo off\r\n@chcp 65001\r\n@if errorlevel 1 exit /b 125\r\n' + code.replace(/\r?\n/g, '\r\n') + '\r\n'
}
