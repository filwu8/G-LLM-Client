/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { SkillConfig, SkillEvalCase, SkillRevision } from './types'

export function bumpPatchVersion(version: string): string {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return '1.0.0'
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function currentRevision(skill: SkillConfig, reason: string, now: number): SkillRevision {
  return {
    version: skill.version,
    description: skill.description,
    instructions: skill.instructions,
    reason,
    createdAt: now
  }
}

export function evolveSkill(skill: SkillConfig, instructions: string, reason: string, now = Date.now()): SkillConfig {
  const nextInstructions = instructions.trim()
  if (!nextInstructions) throw new Error('Skill 规则不能为空')
  return {
    ...skill,
    version: bumpPatchVersion(skill.version),
    instructions: nextInstructions,
    revisions: [...(skill.revisions ?? []), currentRevision(skill, reason.trim() || '迭代前版本', now)].slice(-50),
    updatedAt: now
  }
}

export function rollbackSkill(skill: SkillConfig, version: string, now = Date.now()): SkillConfig {
  const revision = (skill.revisions ?? []).find((item) => item.version === version)
  if (!revision) throw new Error('找不到要回滚的 Skill 版本')
  return {
    ...skill,
    version: bumpPatchVersion(skill.version),
    description: revision.description,
    instructions: revision.instructions,
    revisions: [...(skill.revisions ?? []), currentRevision(skill, `回滚到 ${version} 前的版本`, now)].slice(-50),
    updatedAt: now
  }
}

export function addSkillEvalCase(
  skill: SkillConfig,
  input: string,
  expectedIncludes: string[],
  sampleOutput: string,
  now = Date.now()
): SkillConfig {
  const normalizedExpected = expectedIncludes.map((item) => item.trim()).filter(Boolean).slice(0, 30)
  if (!input.trim() || normalizedExpected.length === 0) throw new Error('评测输入和验收要点不能为空')
  const evalCase: SkillEvalCase = {
    id: `eval_${now}_${Math.random().toString(16).slice(2)}`,
    input: input.trim().slice(0, 8000),
    expectedIncludes: normalizedExpected,
    sampleOutput: sampleOutput.trim().slice(0, 20_000),
    enabled: true,
    createdAt: now
  }
  return { ...skill, evalCases: [...(skill.evalCases ?? []), evalCase].slice(-100), updatedAt: now }
}

export function evaluateSkillRegression(skill: SkillConfig, now = Date.now()): SkillConfig {
  let passed = 0
  let failed = 0
  const evalCases = (skill.evalCases ?? []).map((evalCase) => {
    if (!evalCase.enabled) return evalCase
    const normalizedOutput = evalCase.sampleOutput.toLocaleLowerCase()
    const missing = evalCase.expectedIncludes.filter((criterion) => !normalizedOutput.includes(criterion.toLocaleLowerCase()))
    const casePassed = missing.length === 0
    if (casePassed) passed += 1
    else failed += 1
    return { ...evalCase, lastPassed: casePassed, lastEvaluatedAt: now, lastMissingCriteria: missing }
  })
  return {
    ...skill,
    evalCases,
    lastEvaluation: { skillVersion: skill.version, passed, failed, total: passed + failed, evaluatedAt: now },
    updatedAt: now
  }
}
