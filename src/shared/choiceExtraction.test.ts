/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { extractChoicesFromReply } from './choiceExtraction.ts'

const REAL_REPLY = `任务未完成。
端口关系已理解并采纳：HTTPS 直接走 https://codes.gejiesoft.com（Apache 转 443），SSH 用 8202 端口。但本轮实测后仍被两件事卡住，需要您做一步操作：
【实测结论】
HTTPS 443 通路是通的：服务器返回的是 GitLab 的认证拒绝（HTTP Basic: Access denied），不是连接/端口错误。
【请您二选一，完成后我立即接手】 方案 A（推荐，走 SSH 8202，前提是前辈的 SSH 公钥已加到 GitLab）：在 PowerShell 执行下面脚本，把三个仓库的 origin 统一切到 SSH:8202（自动保留各自原路径）：
$repos = @('C:\\GordonFiles\\CodeDev\\erpv3dev')
foreach ($r in $repos) { $u = git -C $r remote get-url origin }
方案 B（继续走 HTTPS 443，只修凭据）：凭据管理器 → Windows 凭据 → 删除 git:https://codes.gejiesoft.com 条目；到 GitLab 用户设置新建 Access Token。
或者：在 Agent 设置中启用 Python/Shell 执行权限，我可以自己完成改地址、验证连通、拉取全过程。`

test('提取自由文本里的"方案 A / 方案 B"二选一', () => {
  const result = extractChoicesFromReply(REAL_REPLY)
  assert.ok(result, 'expected choices')
  assert.equal(result.options.length, 2)
  assert.match(result.options[0], /^方案 A/)
  assert.match(result.options[1], /^方案 B/)
  // 选项标签要保持简短，不能把整段脚本塞进去
  assert.ok(result.options.every((option) => option.length <= 60), result.options.join(' | '))
  // 提示语来自"请您二选一"
  assert.match(result.prompt, /二选一|选择/)
})

test('fenced choices block wins over heuristics', () => {
  const reply = [
    '我核对完了，需要你定一下方向。',
    '方案 A 是上一轮讨论的内容，不算本轮选项。',
    '```choices',
    '请选择下一步',
    '- 方案 A：先 fetch 再对齐',
    '- 方案 B：先备份本地提交',
    '```',
    '选完我立刻继续。'
  ].join('\n')
  const result = extractChoicesFromReply(reply)
  assert.ok(result)
  assert.equal(result.prompt, '请选择下一步')
  assert.deepEqual(result.options, ['方案 A · 先 fetch 再对齐', '方案 B · 先备份本地提交'])
})

test('fenced block parses labels and prompt', () => {
  const reply = '说明如下。\n```choices\n请选择下一步\n- 走 SSH 8202\n- 修 HTTPS 凭据\n- 先只做 fetch\n```'
  const result = extractChoicesFromReply(reply)
  assert.ok(result)
  assert.equal(result.prompt, '请选择下一步')
  assert.deepEqual(result.options, ['走 SSH 8202', '修 HTTPS 凭据', '先只做 fetch'])
})

test('普通编号清单不会被误判为选择', () => {
  const reply = '这次改动分为几步：\n1. 安装依赖并初始化\n2. 运行类型检查和单元测试\n3. 构建并校验产物\n完成后我会回报结果。'
  assert.equal(extractChoicesFromReply(reply), null)
})

test('编号清单带明确的"请选择"提示时才会变成选项', () => {
  const reply = '有两种处理方式，请选择一种：\n1. 保留本地提交并新建备份分支\n2. 直接以远端为准重置\n告诉我你的选择即可。'
  const result = extractChoicesFromReply(reply)
  assert.ok(result)
  assert.equal(result.options.length, 2)
})

test('字母选项 A) / B) 带选择提示时可用', () => {
  const reply = '需要你确认走哪条路，二选一即可：\nA) 用只读 Access Token 走 HTTPS\nB) 切换到 SSH 公钥认证'
  const result = extractChoicesFromReply(reply)
  assert.ok(result)
  assert.equal(result.options.length, 2)
})

test('普通技术说明里只有单个"方案"时不出选项', () => {
  const reply = '方案 A 是当前采用的做法：通过 Apache 反代 443 端口。如果你还有疑问可以继续问我。'
  assert.equal(extractChoicesFromReply(reply), null)
})

test('过短回复不产生选项', () => {
  assert.equal(extractChoicesFromReply('好的，已完成。'), null)
})

test('选项去重并限制数量', () => {
  const reply = '请选择一项：\n1. 方案一的做法说明\n2. 方案一的做法说明\n3. 方案三的做法说明\n4. 方案四\n5. 方案五\n6. 方案六\n7. 方案七'
  const result = extractChoicesFromReply(reply)
  assert.ok(result)
  assert.ok(result.options.length <= 6)
  const unique = new Set(result.options.map((option) => option.toLowerCase()))
  assert.equal(unique.size, result.options.length)
})
