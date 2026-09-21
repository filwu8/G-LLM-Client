/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/** Returns the native clipboard format used for SVG image data on each OS. */
export function getSvgClipboardFormat(platform: string): string {
  return platform === 'darwin' ? 'public.svg-image' : 'image/svg+xml'
}
