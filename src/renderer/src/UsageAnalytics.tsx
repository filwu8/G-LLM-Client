/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { BarChart3, Bot, Clock3, Database, MessageSquareText, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { LocalUsageStats, UsageRankingItem } from './localUsageStats'

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 10_000 ? 0 : 1))}K`
  return String(value)
}

function formatDuration(value: number, language: string): string {
  const totalMinutes = Math.max(0, Math.round(value / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (language.startsWith('zh')) return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

function heatLevel(tokens: number, maximum: number): number {
  if (tokens <= 0 || maximum <= 0) return 0
  const ratio = tokens / maximum
  if (ratio >= 0.75) return 4
  if (ratio >= 0.45) return 3
  if (ratio >= 0.2) return 2
  return 1
}

function RankingList({ empty, items, suffix }: { empty: string; items: UsageRankingItem[]; suffix: string }) {
  if (items.length === 0) return <p className="usage-ranking-empty">{empty}</p>
  return (
    <div className="usage-ranking-list">
      {items.slice(0, 4).map((item, index) => (
        <div key={item.id}>
          <span className="usage-ranking-index">{index + 1}</span>
          <strong title={item.label}>{item.label}</strong>
          <span>{item.count} {suffix}</span>
        </div>
      ))}
    </div>
  )
}

export function UsageAnalyticsPanel({
  stats,
  conversationCount,
  assistantCount,
  skillCount,
  toolCount
}: {
  stats: LocalUsageStats
  conversationCount: number
  assistantCount: number
  skillCount: number
  toolCount: number
}) {
  const { t, i18n } = useTranslation()
  const formatter = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' })
  const maximum = Math.max(0, ...stats.days.map((day) => day.tokens))
  const weeks = Array.from({ length: Math.ceil(stats.days.length / 7) }, (_, index) => stats.days.slice(index * 7, index * 7 + 7))

  return (
    <div className="settings-tab-panel analytics-settings-panel">
      <section className="analytics-scope-note">
        <Database size={19} />
        <div>
          <strong>{t('analytics.title')}</strong>
          <p>{t('analytics.localScope')}</p>
        </div>
      </section>

      <section className="usage-metric-grid">
        <div><strong>{compactNumber(stats.totalTokens)}</strong><span>{t('analytics.totalTokens')}</span></div>
        <div><strong>{compactNumber(stats.peakDayTokens)}</strong><span>{t('analytics.peakTokens')}</span></div>
        <div><strong>{formatDuration(stats.longestConversationDurationMs, i18n.language)}</strong><span>{t('analytics.longestConversation')}</span></div>
        <div><strong>{stats.currentStreak}</strong><span>{t('analytics.currentStreakDays')}</span></div>
        <div><strong>{stats.longestStreak}</strong><span>{t('analytics.longestStreakDays')}</span></div>
      </section>

      <section className="usage-activity-card">
        <div className="usage-section-head">
          <div>
            <strong>{t('analytics.tokenActivity')}</strong>
            <small>{t('analytics.last84Days')}</small>
          </div>
          <span>{t('analytics.localOnly')}</span>
        </div>
        <div className="usage-heatmap-scroll">
          <div className="usage-heatmap" aria-label={t('analytics.tokenActivity')}>
            {weeks.map((week, weekIndex) => (
              <div className="usage-heatmap-week" key={week[0]?.key ?? weekIndex}>
                {week.map((day) => (
                  <span
                    aria-label={t('analytics.dayDetail', { date: formatter.format(day.timestamp), tokens: day.tokens, messages: day.messages })}
                    className={`usage-heatmap-day level-${heatLevel(day.tokens, maximum)}`}
                    key={day.key}
                    title={t('analytics.dayDetail', { date: formatter.format(day.timestamp), tokens: compactNumber(day.tokens), messages: day.messages })}
                  />
                ))}
                {(weekIndex === 0 || weekIndex === weeks.length - 1 || weekIndex % 4 === 0) && (
                  <small>{formatter.format(week[0]?.timestamp ?? Date.now())}</small>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="usage-heatmap-legend">
          <span>{t('analytics.less')}</span>
          {[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}
          <span>{t('analytics.more')}</span>
        </div>
      </section>

      <div className="usage-detail-grid">
        <section className="usage-insights-card">
          <div className="usage-section-head"><strong>{t('analytics.insights')}</strong></div>
          <div className="usage-insight-list">
            <div><Clock3 size={17} /><span>{t('analytics.currentStreak')}</span><strong>{t('analytics.daysValue', { count: stats.currentStreak })}</strong></div>
            <div><BarChart3 size={17} /><span>{t('analytics.longestStreak')}</span><strong>{t('analytics.daysValue', { count: stats.longestStreak })}</strong></div>
            <div><Wrench size={17} /><span>{t('analytics.toolCalls')}</span><strong>{stats.toolCalls}</strong></div>
            <div><MessageSquareText size={17} /><span>{t('analytics.localObjects')}</span><strong>{conversationCount + assistantCount + skillCount + toolCount}</strong></div>
          </div>
        </section>

        <section className="usage-ranking-card">
          <div className="usage-section-head"><Bot size={17} /><strong>{t('analytics.topModels')}</strong></div>
          <RankingList empty={t('analytics.noActivity')} items={stats.topModels} suffix={t('analytics.responsesUnit')} />
        </section>

        <section className="usage-ranking-card">
          <div className="usage-section-head"><MessageSquareText size={17} /><strong>{t('analytics.topAssistants')}</strong></div>
          <RankingList empty={t('analytics.noActivity')} items={stats.topAssistants} suffix={t('analytics.requestsUnit')} />
        </section>

        <section className="usage-ranking-card">
          <div className="usage-section-head"><Wrench size={17} /><strong>{t('analytics.topTools')}</strong></div>
          <RankingList empty={t('analytics.noToolActivity')} items={stats.topTools} suffix={t('analytics.runsUnit')} />
        </section>
      </div>
    </div>
  )
}
