/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

import type { AppLanguage } from '../shared/i18n'
import type { AppUpdateInfo } from '../shared/types'
import { checkForAppUpdate, DOWNLOAD_PAGE_URL } from './appUpdate'
import { mainT } from './i18n'
import { normalizeDownloadProgress, normalizeReleaseNotes, supportsAutomaticUpdate } from './updatePolicy'

const INITIAL_CHECK_DELAY_MS = 30_000
const AUTOMATIC_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1_000
const { autoUpdater } = electronUpdater

interface AutoUpdateManagerOptions {
  getLanguage: () => AppLanguage
  onStatus: (status: AppUpdateInfo) => void
  beforeInstall: () => void
  log: (message: string, error?: unknown) => void
}

function getReleaseDetails(info: UpdateInfo): Pick<AppUpdateInfo, 'latestVersion' | 'releaseNotes' | 'updatedAt'> {
  return {
    latestVersion: info.version,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    updatedAt: typeof info.releaseDate === 'string' && info.releaseDate.trim() ? info.releaseDate.trim() : undefined
  }
}

export class AutoUpdateManager {
  private readonly supported = supportsAutomaticUpdate(app.isPackaged, process.platform)
  private state: AppUpdateInfo
  private checkPromise: Promise<AppUpdateInfo> | null = null
  private downloadPromise: Promise<AppUpdateInfo> | null = null
  private initialCheckTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: AutoUpdateManagerOptions) {
    this.state = {
      currentVersion: app.getVersion(),
      updateAvailable: false,
      status: 'idle',
      automaticUpdateSupported: this.supported,
      downloadPageUrl: DOWNLOAD_PAGE_URL,
      message: mainT(this.supported ? 'main.update.ready' : 'main.update.manualOnly', options.getLanguage())
    }

    if (!this.supported) return

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoRunAppAfterInstall = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.disableWebInstaller = true
    autoUpdater.fullChangelog = false
    autoUpdater.logger = {
      info: (message) => options.log(`[auto-update] ${String(message)}`),
      warn: (message) => options.log(`[auto-update] warning: ${String(message)}`),
      error: (message) => options.log(`[auto-update] error: ${String(message)}`),
      debug: (message) => options.log(`[auto-update] debug: ${String(message)}`)
    }

    autoUpdater.on('checking-for-update', () => {
      this.publish({
        ...this.state,
        status: 'checking',
        message: mainT('main.update.checking', this.options.getLanguage())
      })
    })
    autoUpdater.on('update-available', (info) => {
      this.publish({
        ...this.baseState(),
        ...getReleaseDetails(info),
        updateAvailable: true,
        status: 'available',
        message: mainT('main.update.available', this.options.getLanguage(), { version: info.version })
      })
    })
    autoUpdater.on('update-not-available', (info) => {
      this.publish({
        ...this.baseState(),
        ...getReleaseDetails(info),
        updateAvailable: false,
        status: 'latest',
        message: mainT('main.update.latest', this.options.getLanguage(), { version: app.getVersion() })
      })
    })
    autoUpdater.on('download-progress', (progress) => this.handleDownloadProgress(progress))
    autoUpdater.on('update-downloaded', (info) => this.handleUpdateDownloaded(info))
    autoUpdater.on('update-cancelled', (info) => {
      this.publish({
        ...this.baseState(),
        ...getReleaseDetails(info),
        updateAvailable: true,
        status: 'available',
        message: mainT('main.update.downloadCancelled', this.options.getLanguage())
      })
    })
    autoUpdater.on('error', (error) => this.handleError(error))
  }

  getState(): AppUpdateInfo {
    return { ...this.state }
  }

  scheduleAutomaticChecks(): void {
    if (!this.supported || this.initialCheckTimer || this.intervalTimer) return

    this.initialCheckTimer = setTimeout(() => {
      this.initialCheckTimer = null
      void this.checkForUpdates()
      this.intervalTimer = setInterval(() => void this.checkForUpdates(), AUTOMATIC_CHECK_INTERVAL_MS)
      this.intervalTimer.unref?.()
    }, INITIAL_CHECK_DELAY_MS)
    this.initialCheckTimer.unref?.()
  }

  async checkForUpdates(): Promise<AppUpdateInfo> {
    if (!this.supported) {
      const fallback = await checkForAppUpdate(app.getVersion(), this.options.getLanguage())
      this.publish(fallback)
      return this.getState()
    }
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return this.getState()
    if (this.checkPromise) return this.checkPromise

    this.checkPromise = (async () => {
      this.publish({
        ...this.state,
        status: 'checking',
        message: mainT('main.update.checking', this.options.getLanguage())
      })
      try {
        await autoUpdater.checkForUpdates()
      } catch (error) {
        if (this.state.status !== 'error') this.handleError(error)
      }
      return this.getState()
    })().finally(() => {
      this.checkPromise = null
    })

    return this.checkPromise
  }

  async downloadUpdate(): Promise<AppUpdateInfo> {
    if (!this.supported || !this.state.updateAvailable) return this.getState()
    if (this.state.status === 'downloaded') return this.getState()
    if (this.downloadPromise) return this.downloadPromise

    this.downloadPromise = (async () => {
      this.publish({
        ...this.state,
        status: 'downloading',
        downloadProgress: 0,
        transferredBytes: 0,
        message: mainT('main.update.downloading', this.options.getLanguage(), { progress: 0 })
      })
      try {
        await autoUpdater.downloadUpdate()
      } catch (error) {
        if (this.state.status !== 'error') this.handleError(error)
      }
      return this.getState()
    })().finally(() => {
      this.downloadPromise = null
    })

    return this.downloadPromise
  }

  installUpdate(): boolean {
    if (!this.supported || this.state.status !== 'downloaded') return false
    this.options.beforeInstall()
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
    return true
  }

  private baseState(): AppUpdateInfo {
    return {
      currentVersion: app.getVersion(),
      updateAvailable: false,
      automaticUpdateSupported: this.supported,
      downloadPageUrl: DOWNLOAD_PAGE_URL,
      status: 'idle',
      message: ''
    }
  }

  private publish(status: AppUpdateInfo): void {
    this.state = status
    this.options.onStatus(this.getState())
  }

  private handleDownloadProgress(progress: ProgressInfo): void {
    const normalizedProgress = normalizeDownloadProgress(progress.percent)
    this.publish({
      ...this.state,
      updateAvailable: true,
      status: 'downloading',
      downloadProgress: normalizedProgress,
      transferredBytes: progress.transferred,
      totalBytes: progress.total,
      message: mainT('main.update.downloading', this.options.getLanguage(), { progress: normalizedProgress })
    })
  }

  private handleUpdateDownloaded(info: UpdateDownloadedEvent): void {
    this.publish({
      ...this.baseState(),
      ...getReleaseDetails(info),
      updateAvailable: true,
      status: 'downloaded',
      downloadProgress: 100,
      message: mainT('main.update.downloaded', this.options.getLanguage(), { version: info.version })
    })
  }

  private handleError(error: unknown): void {
    this.options.log('Automatic update operation failed.', error)
    this.publish({
      ...this.state,
      status: 'error',
      message: mainT('main.update.error', this.options.getLanguage())
    })
  }
}
