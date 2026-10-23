/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import type { ClipboardAttachmentInput } from '@shared/types'

export async function droppedFileInputs(files: File[]): Promise<ClipboardAttachmentInput[]> {
  return Promise.all(files.slice(0, 8).map(async file => {
    if (file.size > 12 * 1024 * 1024) throw new Error('拖入文件上限为 12 MB；更大的文件请使用“添加文件” / Use Add files for files larger than 12 MB')
    const dataUrl = await new Promise<string>((fulfil, reject) => {
      const reader = new FileReader()
      reader.onload = () => fulfil(String(reader.result))
      reader.onerror = () => reject(reader.error ?? new Error('Cannot read file'))
      reader.readAsDataURL(file)
    })
    return { name: file.name, mimeType: file.type || 'application/octet-stream', kind: file.type.startsWith('image/') ? 'image' as const : 'file' as const, size: file.size, dataUrl }
  }))
}
