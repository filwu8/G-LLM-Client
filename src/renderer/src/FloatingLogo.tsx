/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import blueBodyClosed from '../../../resources/spine/gllm-companion/pet/blue/body-closed.png'
import blueBodyHalf from '../../../resources/spine/gllm-companion/pet/blue/body-half.png'
import blueBodyOpen from '../../../resources/spine/gllm-companion/pet/blue/body-open.png'
import blueOrbitBack from '../../../resources/spine/gllm-companion/pet/blue/orbit-back.png'
import blueOrbitFront from '../../../resources/spine/gllm-companion/pet/blue/orbit-front.png'
import goldBodyClosed from '../../../resources/spine/gllm-companion/pet/gold/body-closed.png'
import goldBodyHalf from '../../../resources/spine/gllm-companion/pet/gold/body-half.png'
import goldBodyOpen from '../../../resources/spine/gllm-companion/pet/gold/body-open.png'
import goldOrbitBack from '../../../resources/spine/gllm-companion/pet/gold/orbit-back.png'
import goldOrbitFront from '../../../resources/spine/gllm-companion/pet/gold/orbit-front.png'
import type { FloatingMascotSkin } from '../../shared/types'
import { applyRendererLanguage } from './i18n'

type DragState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

type MascotActivity = 'idle' | 'thinking' | 'success' | 'error'
type BodyFrame = 'open' | 'half' | 'closed'

const DRAG_THRESHOLD = 4
const ORBIT_TILT = -0.192

const mascotAssets = {
  blue: {
    body: { open: blueBodyOpen, half: blueBodyHalf, closed: blueBodyClosed },
    orbitBack: blueOrbitBack,
    orbitFront: blueOrbitFront
  },
  gold: {
    body: { open: goldBodyOpen, half: goldBodyHalf, closed: goldBodyClosed },
    orbitBack: goldOrbitBack,
    orbitFront: goldOrbitFront
  }
} satisfies Record<FloatingMascotSkin, {
  body: Record<BodyFrame, string>
  orbitBack: string
  orbitFront: string
}>

function loadImage(source: string): HTMLImageElement {
  const image = new Image()
  image.src = source
  return image
}

function getOrbitPoint(angle: number, canvasSize: number): { x: number; y: number; front: boolean } {
  const localX = canvasSize * 0.437 * Math.cos(angle)
  const localY = canvasSize * 0.174 * Math.sin(angle)
  return {
    x: canvasSize * 0.5 + localX * Math.cos(ORBIT_TILT) - localY * Math.sin(ORBIT_TILT),
    y: canvasSize * 0.489 + localX * Math.sin(ORBIT_TILT) + localY * Math.cos(ORBIT_TILT),
    front: Math.sin(angle) >= 0
  }
}

function drawOrbitSpark(
  context: CanvasRenderingContext2D,
  angle: number,
  activity: MascotActivity,
  skin: FloatingMascotSkin,
  alpha: number,
  canvasSize: number
): void {
  const { x, y } = getOrbitPoint(angle, canvasSize)
  const glowRadius = canvasSize * 0.0625
  const coreRadius = canvasSize * 0.0142
  const color = activity === 'error'
    ? [255, 86, 112]
    : activity === 'success'
      ? [78, 232, 176]
      : skin === 'gold'
        ? [255, 193, 57]
        : [42, 224, 255]
  const glow = context.createRadialGradient(x, y, 0, x, y, glowRadius)
  glow.addColorStop(0, `rgba(255, 255, 250, ${alpha})`)
  glow.addColorStop(0.24, `rgba(${color.join(', ')}, ${alpha * 0.96})`)
  glow.addColorStop(1, `rgba(${color.join(', ')}, 0)`)
  context.fillStyle = glow
  context.beginPath()
  context.arc(x, y, glowRadius, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = `rgba(255, 255, 255, ${alpha})`
  context.beginPath()
  context.arc(x, y, coreRadius, 0, Math.PI * 2)
  context.fill()
}

function getBlinkFrame(elapsed: number): BodyFrame {
  if (elapsed < 0 || elapsed > 230) return 'open'
  if (elapsed < 65) return 'half'
  if (elapsed < 155) return 'closed'
  return 'half'
}

export default function FloatingLogo() {
  const { t } = useTranslation()
  const dragState = useRef<DragState | null>(null)
  const activityResetTimer = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [activity, setActivity] = useState<MascotActivity>('idle')
  const [skin, setSkin] = useState<FloatingMascotSkin>('blue')
  const [canvasSize, setCanvasSize] = useState(() => Math.max(1, Math.min(window.innerWidth, window.innerHeight)))

  useEffect(() => {
    const handleResize = () => setCanvasSize(Math.max(1, Math.min(window.innerWidth, window.innerHeight)))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    void window.gllm.getState().then((state) => applyRendererLanguage(state.settings.language))
    return window.gllm.onSettingsChanged((settings) => applyRendererLanguage(settings.language))
  }, [])

  useEffect(() => {
    void window.gllm.getFloatingMascotSkin().then(setSkin)
    return window.gllm.onFloatingMascotSkinChanged(setSkin)
  }, [])

  useEffect(() => {
    const unsubscribe = window.gllm.onChatActivity((event) => {
      if (activityResetTimer.current !== null) window.clearTimeout(activityResetTimer.current)
      activityResetTimer.current = null

      if (event.active) {
        setActivity('thinking')
        return
      }

      setActivity(event.error ? 'error' : 'success')
      activityResetTimer.current = window.setTimeout(() => {
        setActivity('idle')
        activityResetTimer.current = null
      }, event.error ? 4200 : 1800)
    })

    return () => {
      unsubscribe()
      if (activityResetTimer.current !== null) window.clearTimeout(activityResetTimer.current)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(canvasSize * devicePixelRatio)
    canvas.height = Math.round(canvasSize * devicePixelRatio)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'

    const sources = mascotAssets[skin]
    const images = {
      orbitBack: loadImage(sources.orbitBack),
      orbitFront: loadImage(sources.orbitFront),
      body: {
        open: loadImage(sources.body.open),
        half: loadImage(sources.body.half),
        closed: loadImage(sources.body.closed)
      }
    }
    let animationFrame = 0
    let disposed = false
    let nextBlinkAt = performance.now() + 1800 + Math.random() * 2600
    let blinkStartedAt = -1
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const draw = (timestamp: number) => {
      if (disposed) return
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      context.clearRect(0, 0, canvasSize, canvasSize)

      if (!reducedMotion && blinkStartedAt < 0 && timestamp >= nextBlinkAt) blinkStartedAt = timestamp
      const blinkElapsed = blinkStartedAt < 0 ? -1 : timestamp - blinkStartedAt
      const bodyFrame = getBlinkFrame(blinkElapsed)
      if (blinkStartedAt >= 0 && blinkElapsed > 230) {
        blinkStartedAt = -1
        nextBlinkAt = timestamp + 2800 + Math.random() * 3900
      }

      const seconds = timestamp / 1000
      const speed = activity === 'thinking' ? 1.9 : activity === 'error' ? 0.65 : activity === 'success' ? 1.15 : 0.58
      const orbitAngle = seconds * speed + 0.55
      const orbitPoint = getOrbitPoint(orbitAngle, canvasSize)
      const floatOffset = reducedMotion || isDragging ? 0 : Math.sin(seconds * 1.55) * canvasSize * 0.008
      context.save()
      context.translate(0, floatOffset)
      context.drawImage(images.orbitBack, 0, 0, canvasSize, canvasSize)
      if (!orbitPoint.front && !reducedMotion) drawOrbitSpark(context, orbitAngle, activity, skin, 0.72, canvasSize)
      context.drawImage(images.body[bodyFrame], 0, 0, canvasSize, canvasSize)
      context.drawImage(images.orbitFront, 0, 0, canvasSize, canvasSize)
      if (orbitPoint.front && !reducedMotion) drawOrbitSpark(context, orbitAngle, activity, skin, 1, canvasSize)
      context.restore()

      if (!reducedMotion) animationFrame = window.requestAnimationFrame(draw)
    }

    const allImages = [images.orbitBack, images.orbitFront, ...Object.values(images.body)]
    Promise.all(allImages.map((image) => image.decode().catch(() => undefined))).then(() => draw(performance.now()))

    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
    }
  }, [activity, canvasSize, isDragging, skin])

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false
    }
    window.gllm.beginFloatingLogoDrag()
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return
    const distance = Math.hypot(event.screenX - state.startX, event.screenY - state.startY)
    if (!state.moved && distance < DRAG_THRESHOLD) return
    event.preventDefault()
    if (!state.moved) {
      state.moved = true
      setIsDragging(true)
    }
    window.gllm.moveFloatingLogoDrag()
  }

  function finishDrag(event: React.PointerEvent<HTMLButtonElement>, shouldOpenPanel: boolean) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return
    event.preventDefault()
    dragState.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    window.gllm.endFloatingLogoDrag()
    setIsDragging(false)
    if (shouldOpenPanel && !state.moved) void window.gllm.showQuickPanel()
  }

  function openFromKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    void window.gllm.showQuickPanel()
  }

  return (
    <button
      aria-label={t('native.openQuickChat')}
      className={`floating-logo-button ${activity} ${isDragging ? 'dragging' : ''}`}
      title={t('native.openQuickChat')}
      type="button"
      onContextMenu={(event) => {
        event.preventDefault()
        void window.gllm.showFloatingLogoMenu()
      }}
      onDragStart={(event) => event.preventDefault()}
      onKeyDown={openFromKeyboard}
      onPointerCancel={(event) => finishDrag(event, false)}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={(event) => finishDrag(event, true)}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="floating-logo-canvas" />
    </button>
  )
}
