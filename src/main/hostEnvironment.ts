/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { arch, platform, release } from 'node:os'

interface HostEnvironment { platform: string; release: string; arch: string; systemVersion?: string }
export function buildHostEnvironmentContext(host: HostEnvironment = { platform: platform(), release: release(), arch: arch(), systemVersion: process.getSystemVersion?.() }, agent = false): string {
  const name = host.platform === 'darwin' ? 'macOS' : host.platform === 'win32' ? 'Windows' : host.platform === 'linux' ? 'Linux' : host.platform
  return `[Current computer — supplied by the desktop client]\nOS: ${name}; kernel version: ${host.release}; architecture: ${host.arch}.${host.systemVersion ? ` OS version: ${host.systemVersion}.` : ''}\n` +
    `Workspace shell: ${host.platform === 'win32' ? 'Windows CMD batch' : '/bin/sh (POSIX)'}. Computer command shell: ${host.platform === 'win32' ? 'Windows PowerShell' : '/bin/sh (POSIX)'}.\n` +
    'Use this actual platform for installation packages, paths and commands. Do not infer the OS from chat history. On macOS do not create .ps1/.bat or Windows instructions unless the user explicitly targets Windows; on Windows do not assume POSIX tools. Produce only the current platform’s solution unless multiple platforms are requested. Installed software, package managers, administrator privileges and OS automation permissions are unknown until inspected.\n' +
    (agent
      ? 'Use the enabled tools to inspect prerequisites, perform the requested installation or operation, and verify the result. Creating an installer script alone does not complete an installation. Computer and browser tools require approval on every call; workspace authorization does not grant computer access. If disabled, direct the user to Agent settings. Do not bypass a disabled capability through another tool.\n'
      : 'This chat has no computer execution or browser interaction tools. For an installation or an actual computer/browser action, direct the user to “电脑与浏览器 / Computer & browser” beside the message input, then enable the needed capability in Agent settings. Explain what authorization is needed; never claim to have executed an action or invent inspection results. Do not substitute multiple installer scripts for a requested installation.\n')
}
