import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { postMeetingMessage, readMeetingRoom } from '../src/main/meetingRoom.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-smoke-'))
const seatDir = path.join(root, '测试席位甲')
fs.mkdirSync(path.join(seatDir, 'data'), { recursive: true })
const script = path.join(seatDir, 'data', 'append_room.ps1')
fs.copyFileSync(
  'C:/Users/jifeicmk/Desktop/vb/AI交易系统_五席位/大投机家利弗莫尔/data/append_room.ps1',
  script
)
const room = path.join(root, 'AI会议室.txt')
const rule = '='.repeat(64)
fs.writeFileSync(room, [
  `【测试席位甲】下午收盘总结`,
  '正文一行',
  '署名：测试席位甲',
  '写入时间：2026-11-19 15:00:00',
  rule,
  ''
].join('\n'), 'utf8')

const before = readMeetingRoom(room)
const posted = await postMeetingMessage({ scriptPath: script, roomPath: room, seat: '测试席位乙', body: '冒烟测试正文' })
const after = readMeetingRoom(room)
console.log(JSON.stringify({
  tailCompleteBefore: before.tailComplete,
  postsBefore: before.posts.length,
  roomBytesAfter: fs.statSync(room).size,
  rootFiles: fs.readdirSync(root),
  skippedAfter: after.skipped,
  postedAt: posted.at,
  postsAfter: after.posts.length,
  tailCompleteAfter: after.tailComplete,
  lastSeat: after.posts.at(-1)?.seat,
  lastBody: after.posts.at(-1)?.body,
  lastAt: after.posts.at(-1)?.at
}, null, 2))
fs.rmSync(root, { recursive: true, force: true })
