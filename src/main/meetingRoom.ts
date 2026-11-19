import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** A post closes with 署名 / 写入时间 / 64 '=' — the same tail append_room.ps1 writes. */
const POST_TAIL_PATTERN = '署名：([^\\r\\n]{1,80})\\r?\\n写入时间：([^\\r\\n]{1,40})\\r?\\n={64}'
const RULE_PATTERN = /^[=═]{4,}$/

export interface MeetingPost {
  seat: string
  at: string
  body: string
}

export interface MeetingRoomSnapshot {
  path: string
  bytes: number
  /** False when the file does not end with a complete post; the script refuses to append then. */
  tailComplete: boolean
  posts: MeetingPost[]
  skipped: number
}

export interface MeetingRoomPostResult {
  at: string
  seat: string
  bytes: number
  appendBytes: number
}

/**
 * The byte-lock append protocol lives in append_room.ps1. Reimplementing the
 * FileStream.Lock(0,1) lease in Node is not possible, so writes shell out to it.
 */
export function resolveMeetingScript(workspaceRoot: string): string | undefined {
  const direct = path.join(workspaceRoot, 'data', 'append_room.ps1')
  if (fs.existsSync(direct)) return direct
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(workspaceRoot, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(workspaceRoot, entry.name, 'data', 'append_room.ps1')
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

/** The script defaults its room to PSScriptRoot/../../AI会议室.txt. */
export function resolveMeetingRoomFile(scriptPath: string): string {
  return path.resolve(path.dirname(scriptPath), '..', '..', 'AI会议室.txt')
}

export function parseMeetingPosts(text: string): { posts: MeetingPost[]; skipped: number } {
  const posts: MeetingPost[] = []
  let skipped = 0
  let cursor = 0
  const pattern = new RegExp(POST_TAIL_PATTERN, 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const body = text.slice(cursor, match.index).trim()
    if (body) posts.push({ seat: match[1].trim(), at: match[2].trim(), body })
    else skipped += 1
    cursor = match.index + match[0].length
  }
  // Anything after the last complete post is a half-written entry; the script treats that
  // as corruption ("尾部不完整"), so it stays out of the list instead of showing up as a post.
  return { posts, skipped }
}

export function isMeetingTailComplete(text: string): boolean {
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n')
  if (lines.length < 3) return false
  const lastLine = lines[lines.length - 1].trim()
  if (!RULE_PATTERN.test(lastLine)) return false
  return lines.slice(-4).some((line) => line.startsWith('写入时间：'))
}

export function readMeetingRoom(roomPath: string): MeetingRoomSnapshot {
  const stats = fs.statSync(roomPath)
  const text = fs.readFileSync(roomPath, 'utf8')
  const { posts, skipped } = parseMeetingPosts(text)
  return {
    path: roomPath,
    bytes: stats.size,
    tailComplete: isMeetingTailComplete(text),
    posts,
    skipped
  }
}

export async function postMeetingMessage(input: {
  scriptPath: string
  /** Explicit room file so a write lands in the same file readMeetingRoom parsed, even when AI_ROOM_FILE is set. */
  roomPath?: string
  seat: string
  body: string
  timeoutSec?: number
  signal?: AbortSignal
}): Promise<MeetingRoomPostResult> {
  const seat = input.seat.trim().slice(0, 80)
  const body = input.body.trim()
  if (!seat) throw new Error('会议室发帖需要席位署名')
  if (!body) throw new Error('会议室帖子内容为空')
  if (!fs.existsSync(input.scriptPath)) throw new Error(`会议室写入脚本不存在：${input.scriptPath}`)
  const tempFile = path.join(os.tmpdir(), `gllm-meeting-${randomUUID()}.md`)
  fs.writeFileSync(tempFile, body, 'utf8')
  try {
    const { stdout } = await run(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', input.scriptPath,
        '-Action', 'write',
        ...(input.roomPath ? ['-Room', input.roomPath] : []),
        '-Seat', seat,
        '-Post', tempFile,
        ...(input.timeoutSec ? ['-TimeoutSec', String(input.timeoutSec)] : [])
      ],
      {
        timeout: (input.timeoutSec ?? 30) * 1000 + 15_000,
        signal: input.signal,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }
    )
    const lastLine = stdout.trim().split(/\r?\n/).pop() ?? ''
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(lastLine) as Record<string, unknown>
    } catch {
      // The script prints a JSON receipt; a missing one still means the append landed.
    }
    const previousBytes = Number(parsed.previous_bytes)
    const appendedBytes = Number(parsed.appended_bytes)
    return {
      at: typeof parsed.at === 'string' ? parsed.at : '',
      seat: typeof parsed.seat === 'string' ? parsed.seat : seat,
      bytes: Number.isFinite(previousBytes) && Number.isFinite(appendedBytes)
        ? previousBytes + appendedBytes
        : fs.statSync(input.roomPath ?? resolveMeetingRoomFile(input.scriptPath)).size,
      appendBytes: Number.isFinite(appendedBytes) ? appendedBytes : 0
    }
  } finally {
    fs.rmSync(tempFile, { force: true })
  }
}

/** Render posts newest-first for the model; the full bodies stay available through `limit`. */
export function formatMeetingPosts(snapshot: MeetingRoomSnapshot, limit: number): string {
  const posts = snapshot.posts.slice(-Math.max(1, limit))
  if (posts.length === 0) return `会议室 ${snapshot.path} 里还没有可解析的帖子。`
  return posts
    .map((post) => `【${post.seat}】${post.at}\n${post.body}`)
    .join('\n\n---\n\n')
}
