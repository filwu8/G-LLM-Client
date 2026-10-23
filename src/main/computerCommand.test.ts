/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { homedir } from 'node:os'
import { runComputerCommand } from './computerCommand.ts'

test('host computer command uses real home, Unicode and only explicitly selected credentials', async () => {
  process.env.GLLM_TEST_UNSELECTED = 'must-not-inherit'
  try {
    const code = process.platform === 'win32'
      ? 'Write-Output $env:USERPROFILE; Write-Output "电脑测试"; Write-Output $env:GLLM_SELECTED; if ($env:GLLM_TEST_UNSELECTED) { throw "inherited secret" }'
      : 'printf "%s\\n" "$HOME" "电脑测试" "$GLLM_SELECTED"; test -z "$GLLM_TEST_UNSELECTED"'
    const result = await runComputerCommand(process.cwd(), { purpose: 'Check runtime', code, envNames: ['GLLM_SELECTED'] }, ['GLLM_SELECTED'], { GLLM_SELECTED: 'selected-secret' })
    assert.equal(result.exitCode, 0, result.output)
    assert.ok(result.output.includes(homedir()))
    assert.match(result.output, /电脑测试/)
    assert.match(result.output, /\[REDACTED\]/)
    assert.doesNotMatch(result.output, /selected-secret|must-not-inherit/)
  } finally { delete process.env.GLLM_TEST_UNSELECTED }
})
test('computer execution rejects variables that have not been enabled', async () => {
  await assert.rejects(runComputerCommand(process.cwd(), { purpose: 'inspect', code: 'echo ok', envNames: ['SECRET'] }, [], { SECRET: 'hidden' }), /not enabled/)
})
test('computer commands preserve native program failure codes', async () => {
  const code = process.platform === 'win32' ? '& "$env:SystemRoot/System32/cmd.exe" /d /c "exit 17"' : 'exit 17'
  const result = await runComputerCommand(process.cwd(), { purpose: 'Check failed command', code }, [], {})
  assert.equal(result.exitCode, 17, result.output)
})
