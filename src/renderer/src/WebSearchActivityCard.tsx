/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { Globe2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { WebSearchActivity } from '@shared/types'

function getUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function formatSearchResultDate(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function WebSearchActivityCard({ activity }: { activity: WebSearchActivity }) {
  const { t } = useTranslation()
  const isPlanning = activity.status === 'planning'
  const isSearching = activity.status === 'searching'
  const isFailed = activity.status === 'failed'
  const isStopped = activity.status === 'stopped'
  const audit = activity.audit
  const rejectedCount = audit
    ? audit.duplicateCount + audit.outdatedCount + audit.notApplicableCount + audit.lowRelevanceCount
    : 0
  const activeQueries = new Set(activity.activeQueries ?? [])
  const completedQueries = new Set(activity.completedQueries ?? [])
  const title = isPlanning
    ? t('webActivity.planning')
    : isSearching
      ? t('webActivity.searching')
      : isStopped
        ? t('webActivity.stopped')
        : isFailed
          ? t('webActivity.failed')
          : t('webActivity.complete', { count: activity.results.length })

  return (
    <div className={`web-search-card ${activity.status}`}>
      <div className="web-search-head">
        <span className="web-search-icon">
          {isPlanning || isSearching ? (
            <span className="mini-spinner" aria-hidden="true" />
          ) : (
            <Globe2 size={15} />
          )}
        </span>
        <div>
          <strong>{title}</strong>
          <small>{activity.intent || activity.query}</small>
        </div>
      </div>
      {activity.queries && activity.queries.length > 0 && (
        <div className="web-search-query-list">
          {activity.queries.map((query) => (
            <span
              key={query}
              className={completedQueries.has(query) ? 'completed' : activeQueries.has(query) ? 'active' : 'pending'}
            >
              {query}
            </span>
          ))}
        </div>
      )}
      {audit && !isPlanning && (
        <div className="web-research-audit" aria-label={t('webActivity.auditLabel')}>
          <span>{t(`webActivity.depth.${audit.depth}`)}</span>
          {activity.status === 'completed' && (
            <>
              <span>{t('webActivity.evidence', { accepted: audit.acceptedCount, candidates: audit.candidateCount })}</span>
              <span>{t('webActivity.coverage', { covered: audit.coveredQuestionCount, total: audit.totalQuestionCount })}</span>
              {audit.contextCharacterBudget && (
                <span>{t('webActivity.contextBudget', { count: Math.round(audit.contextCharacterBudget / 100) / 10 })}</span>
              )}
              {audit.searchEngines && audit.searchEngines.length > 0 && (
                <span>{t('webActivity.engines', { engines: audit.searchEngines.join(' · ') })}</span>
              )}
              {audit.unavailableSearchEngines && audit.unavailableSearchEngines.length > 0 && (
                <span className="conflict">{t('webActivity.enginesUnavailable', { engines: audit.unavailableSearchEngines.join(' · ') })}</span>
              )}
              {rejectedCount > 0 && <span>{t('webActivity.rejected', { count: rejectedCount })}</span>}
              {audit.conflictCount > 0 && <span className="conflict">{t('webActivity.conflicts', { count: audit.conflictCount })}</span>}
            </>
          )}
          {isSearching && (
            <>
              <span>{t('webActivity.liveProgress', { completed: completedQueries.size, total: activity.queries?.length ?? 0, candidates: audit.candidateCount })}</span>
              {audit.searchEngines && audit.searchEngines.length > 0 && (
                <span>{t('webActivity.engines', { engines: audit.searchEngines.join(' · ') })}</span>
              )}
            </>
          )}
        </div>
      )}
      {audit?.plannerMode === 'fallback' && (
        <p className="web-search-warning" title={audit.plannerError}>
          {t('webActivity.plannerFallback')}
        </p>
      )}
      {isFailed && activity.error && <p className="web-search-error">{activity.error}</p>}
      {activity.results.length > 0 && (
        <div className="web-search-results">
          {activity.results.map((result, index) => (
            <a
              key={`${result.url}-${index}`}
              href={result.url}
              target="_blank"
              rel="noreferrer"
              title={result.url}
              style={{ '--web-result-index': index } as CSSProperties}
            >
              <span>{index + 1}</span>
              <div className="web-search-result-content">
                <strong>{result.title}</strong>
                <small>
                  {result.sourceRole ? `${t(`webActivity.sourceRole.${result.sourceRole}`)} · ` : ''}
                  {result.source || result.sourceDomain || getUrlHost(result.url)}
                  {result.publishedAt ? ` · ${formatSearchResultDate(result.publishedAt)}` : ''}
                </small>
                {result.snippet && <p>{result.snippet.slice(0, 120)}</p>}
                <small>{result.url}</small>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
