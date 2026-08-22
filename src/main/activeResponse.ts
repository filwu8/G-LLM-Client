/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export interface ActiveResponseHandle {
  key: string
  conversationId: string
  controller: AbortController
}

export class ActiveResponseRegistry {
  private readonly responses = new Map<string, ActiveResponseHandle>()

  register(kind: 'chat' | 'workspace', conversationId: string, requestKey = 'main'): ActiveResponseHandle {
    const key = `${kind}:${conversationId}:${requestKey}`
    this.responses.get(key)?.controller.abort()
    const handle = { key, conversationId, controller: new AbortController() }
    this.responses.set(key, handle)
    return handle
  }

  isCurrent(handle: Pick<ActiveResponseHandle, 'key' | 'controller'>): boolean {
    return this.responses.get(handle.key)?.controller === handle.controller
  }

  release(handle: Pick<ActiveResponseHandle, 'key' | 'controller'>): void {
    if (this.isCurrent(handle)) this.responses.delete(handle.key)
  }

  cancelConversation(conversationId: string): void {
    for (const active of this.responses.values()) {
      if (active.conversationId === conversationId) active.controller.abort()
    }
  }
}
