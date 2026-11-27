/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Turn a raw runner stack trace into something the model can act on.
 *
 * The runner reports real Node errors, but the two most common ones are about
 * *how* the script was written, not about the workspace: calling a file API
 * without the `workspace.` prefix, and generating code at runtime (which the
 * isolated context forbids). Reporting those as "this capability is not
 * available" is factually wrong and sends the model looking for a workaround
 * instead of fixing the call.
 */

/** Methods the isolated runner exposes on its `workspace` object. */
export const SCRIPT_WORKSPACE_METHODS: readonly string[] = [
  'list', 'stat', 'readText', 'writeText', 'readBase64', 'writeBase64', 'mkdir', 'copy', 'move'
]

export function friendlyScriptError(raw: string, isEnglish: boolean): string {
  const missingCell = raw.match(/Error:\s*cell\s+([A-Z]+\d+)\s+not found/i)?.[1]
  if (missingCell) {
    return isEnglish
      ? `The script tried to update Excel cell ${missingCell}, but that cell was not found in the workbook XML. The script needs to inspect the sheet structure before editing it.`
      : `脚本准备修改 Excel 单元格 ${missingCell}，但在工作簿内部结构中没有找到该单元格。模板可能采用了不同的存储方式，需要先检查工作表结构再修改。`
  }
  const missingGlobal = raw.match(/ReferenceError:\s*([A-Za-z_$][\w$]*)\s+is not defined/i)?.[1]
  if (missingGlobal) {
    if (SCRIPT_WORKSPACE_METHODS.includes(missingGlobal)) {
      return isEnglish
        ? `The script called ${missingGlobal}(...) directly. Workspace APIs live on the workspace object: use await workspace.${missingGlobal}(...).`
        : `脚本直接调用了 ${missingGlobal}(...)。工作区 API 挂在 workspace 对象上，要写成 await workspace.${missingGlobal}(...)。`
    }
    return isEnglish
      ? `The script requested “${missingGlobal}”, but that capability is not available in the isolated environment. This is a compatibility issue, not a file permission problem.`
      : `脚本使用了隔离环境尚未提供的“${missingGlobal}”功能。这属于脚本兼容性问题，不是文件权限不足。`
  }
  if (/EvalError:\s*Code generation from strings disallowed/i.test(raw)) {
    return isEnglish
      ? 'The script generated code at runtime (eval or new Function). The isolated runner forbids that; write plain functions and loops instead.'
      : '脚本在运行中动态生成代码（eval 或 new Function），隔离执行器不允许这样做。改用普通函数和循环即可。'
  }
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim())?.replace(/^Error:\s*/i, '').trim()
  return firstLine || (isEnglish ? 'The temporary script failed' : '临时脚本运行失败')
}
