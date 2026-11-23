import type { Assistant, AssistantImportResult } from '../shared/types'
import { getAssistants, saveAssistant } from './storage'
import { planAssistantImport } from './assistantImportPlan'

export { planAssistantImport }

/** Plan the import and persist it. Re-running on the same folder updates in place. */
export function importAssistantsFromDirectory(
  rootInput: string,
  options: { parentName?: string; existing?: Assistant[] } = {}
): AssistantImportResult {
  const plan = planAssistantImport(rootInput, {
    parentName: options.parentName,
    existing: options.existing ?? getAssistants()
  })
  const saved = [plan.orchestrator, ...plan.seats].map((assistant) => saveAssistant(assistant))
  return { orchestrator: saved[0], seats: saved.slice(1), skipped: plan.skipped }
}
