import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { planAssistantImport } from './assistantImportPlan.ts'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-import-'))
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '总台规则', 'utf8')
  for (const name of ['席位甲', '席位乙']) {
    const dir = path.join(root, name)
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${name} 规则`, 'utf8')
  }
  fs.mkdirSync(path.join(root, '杂物'))
  return root
}

test('imports every seat folder under one orchestrator', () => {
  const root = fixture()
  try {
    const plan = planAssistantImport(root, { existing: [] })
    assert.equal(plan.seats.length, 2)
    assert.deepEqual(
      plan.seats.map((seat) => seat.name).sort(),
      ['席位甲', '席位乙'].sort()
    )
    assert.equal(plan.skipped.length, 1)
    assert.equal(plan.skipped[0]?.name, '杂物')
    for (const seat of plan.seats) {
      assert.equal(seat.workspaceRoot, path.join(root, seat.name))
      assert.equal(seat.parentAssistantId, plan.orchestrator.id)
      assert.match(seat.systemPrompt, /^你是「.+」席位，工作目录是 .+。人格与记忆以该目录的 AGENTS\.md、MEMORY\.md 为准，开任务前先读它们。$/)
    }
    assert.equal(plan.orchestrator.workspaceRoot, root)
    assert.deepEqual(
      [...plan.orchestrator.delegateAssistantIds ?? []].sort(),
      plan.seats.map((seat) => seat.id).sort()
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('re-importing the same folder updates seats instead of duplicating them', () => {
  const root = fixture()
  try {
    const first = planAssistantImport(root, { existing: [] })
    const persisted = [first.orchestrator, ...first.seats]
    const second = planAssistantImport(root, { existing: persisted })
    assert.equal(second.orchestrator.id, first.orchestrator.id)
    assert.deepEqual(second.seats.map((seat) => seat.id).sort(), first.seats.map((seat) => seat.id).sort())
    assert.equal((second.orchestrator.delegateAssistantIds ?? []).length, 2)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('keeps a seat that the user already configured', () => {
  const root = fixture()
  try {
    const first = planAssistantImport(root, { existing: [] })
    const seat = first.seats[0]
    const customized = { ...seat, name: '改名后的席位', modelId: 'seat-model' }
    const second = planAssistantImport(root, { existing: [first.orchestrator, customized, first.seats[1]] })
    const sameSeat = second.seats.find((item) => item.id === seat.id)
    assert.ok(sameSeat)
    assert.equal(sameSeat.name, '改名后的席位')
    assert.equal(sameSeat.modelId, 'seat-model')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
