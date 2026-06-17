import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, CheckCircle2, ExternalLink, Mail, RefreshCcw, Trash2 } from 'lucide-react';
import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { getCaseEmails, updateCaseEmail, updateCaseSettings } from '../utils/api';

const parseDate = (value) => {
  if (!value) {
    return null;
  }
  try {
    const parsed = parseISO(String(value));
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const formatEmailDate = (value) => {
  const parsed = parseDate(value);
  return parsed ? format(parsed, 'yyyy-MM-dd HH:mm') : 'Date unknown';
};

const formatShortDate = (value) => {
  const parsed = parseDate(value);
  return parsed ? format(parsed, 'MMM d, yyyy') : value || 'Not detected';
};

const deadlineMood = (date) => {
  const parsed = parseDate(date);
  if (!parsed) {
    return { label: 'No date', className: 'badge badge-low', diff: null };
  }
  const diff = differenceInCalendarDays(parsed, new Date());
  if (diff <= 0) {
    return { label: 'Overdue', className: 'badge badge-high', diff };
  }
  if (diff <= 14) {
    return { label: `${diff} days left`, className: 'badge badge-medium', diff };
  }
  return { label: `${diff} days left`, className: 'badge badge-low', diff };
};

const statusLabel = (status) => (status === 'active' ? 'In progress' : status || 'active');

const deadlineKey = (deadline) => [
  deadline?.date || '',
  String(deadline?.action || 'Review deadline').trim().toLowerCase().replace(/\s+/g, ' '),
  deadline?.time || '',
].join('|');

const cleanAction = (action) => action || 'Review deadline';

const formatParserSource = (source) => {
  if (source === 'ai_fallback') {
    return 'AI fallback';
  }
  if (source === 'rule_based') {
    return 'Rule-based';
  }
  if (source === 'rule_fallback') {
    return 'Rule fallback';
  }
  return 'Parser result';
};

const buildDeadlineRows = (deadlines = []) => {
  const byKey = new Map();
  for (const deadline of deadlines) {
    const parsed = parseDate(deadline?.date);
    if (!parsed) {
      continue;
    }
    const key = deadlineKey(deadline);
    const existing = byKey.get(key);
    byKey.set(key, {
      ...existing,
      ...deadline,
      date: deadline.date,
      action: cleanAction(deadline.action),
      parsed,
      diff: differenceInCalendarDays(parsed, new Date()),
    });
  }

  return [...byKey.values()].sort((a, b) => (
    `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`)
  ));
};

export default function CaseDetail({
  caseItem,
  onBack,
  onStatusChange,
  onDelete,
}) {
  const [relatedEmails, setRelatedEmails] = useState([]);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [showPastDeadlines, setShowPastDeadlines] = useState(false);
  const [caseSettings, setCaseSettings] = useState({
    calendarAutoEnabled: caseItem.calendarAutoEnabled !== false,
    reviewBeforeCalendarUpdate: Boolean(caseItem.reviewBeforeCalendarUpdate),
    calendarUpdateHistory: Array.isArray(caseItem.calendarUpdateHistory) ? caseItem.calendarUpdateHistory : [],
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const status = caseItem.status || 'active';
  const caseColor = caseItem.caseColor || '#0071e3';
  const caseId = caseItem.caseId || '(No case ID)';
  const caseTitle = caseItem.caseTitle || caseId;
  const discoverySets = Array.isArray(caseItem.discoverySets) && caseItem.discoverySets.length
    ? caseItem.discoverySets.join(', ')
    : 'Not detected';
  const deadlines = Array.isArray(caseItem.deadlines) ? caseItem.deadlines : [];
  const summaryText = caseItem.summary && !caseItem.summary.startsWith(`[${caseId}]`)
    ? caseItem.summary
    : 'Case folder summary will update as CaseSync detects emails, attachments, and deadlines.';

  const deadlineRows = useMemo(() => buildDeadlineRows(deadlines), [deadlines]);
  const upcomingDeadlineRows = useMemo(() => deadlineRows.filter((item) => item.diff >= 0), [deadlineRows]);
  const pastDeadlineRows = useMemo(() => deadlineRows.filter((item) => item.diff < 0).reverse(), [deadlineRows]);
  const fallbackDeadlineDate = caseItem.responseDeadlineDate || caseItem.nextDeadline?.date || deadlineRows[0]?.date || '';
  const primaryDeadlineRow = upcomingDeadlineRows.find((item) => item.date === fallbackDeadlineDate)
    || upcomingDeadlineRows[0]
    || null;
  const primaryDeadline = primaryDeadlineRow?.date || fallbackDeadlineDate;
  const primaryMood = deadlineMood(primaryDeadline);
  const visibleRelatedEmails = useMemo(() => relatedEmails.filter((email) => (
    email.classification !== 'not_relevant'
  )), [relatedEmails]);
  const aiEmailAnalyses = useMemo(() => visibleRelatedEmails
    .map((email) => ({
      messageId: email.messageId,
      subject: email.subject,
      receivedAt: email.receivedAt,
      parserSource: email.raw?.parserSource || '',
      analysis: email.raw?.aiAnalysis || null,
    }))
    .filter((item) => item.analysis), [visibleRelatedEmails]);

  const loadEmails = async () => {
    setEmailLoading(true);
    setEmailError('');
    try {
      const emails = await getCaseEmails(caseId);
      setRelatedEmails(emails);
    } catch (error) {
      setEmailError(error.response?.data?.error || error.message || 'Failed to load related emails');
    } finally {
      setEmailLoading(false);
    }
  };

  useEffect(() => {
    void loadEmails();
  }, [caseId]);

  useEffect(() => {
    setCaseSettings({
      calendarAutoEnabled: caseItem.calendarAutoEnabled !== false,
      reviewBeforeCalendarUpdate: Boolean(caseItem.reviewBeforeCalendarUpdate),
      calendarUpdateHistory: Array.isArray(caseItem.calendarUpdateHistory) ? caseItem.calendarUpdateHistory : [],
    });
  }, [caseItem]);

  const saveCaseSettings = async (patch) => {
    const next = { ...caseSettings, ...patch };
    setCaseSettings(next);
    setSettingsSaving(true);
    try {
      const updated = await updateCaseSettings(caseId, patch);
      setCaseSettings({
        calendarAutoEnabled: updated.calendarAutoEnabled !== false,
        reviewBeforeCalendarUpdate: Boolean(updated.reviewBeforeCalendarUpdate),
        calendarUpdateHistory: Array.isArray(updated.calendarUpdateHistory) ? updated.calendarUpdateHistory : [],
      });
    } catch (error) {
      setEmailError(error.response?.data?.error || error.message || 'Failed to update case settings');
      setCaseSettings(caseSettings);
    } finally {
      setSettingsSaving(false);
    }
  };

  const markEmailReviewed = async (messageId) => {
    try {
      await updateCaseEmail(caseId, messageId, {
        needsReview: false,
        classification: 'reviewed',
        sourceReason: 'Reviewed manually in CaseSync.',
      });
      await loadEmails();
    } catch (error) {
      setEmailError(error.response?.data?.error || error.message || 'Failed to update email');
    }
  };

  const moveEmailToCase = async (messageId) => {
    const nextCaseId = window.prompt('Move this email to which case ID?', caseId);
    if (!nextCaseId || nextCaseId.trim() === caseId) {
      return;
    }

    try {
      await updateCaseEmail(caseId, messageId, {
        caseId: nextCaseId.trim(),
        needsReview: false,
        classification: 'manual',
        sourceReason: `Moved manually from ${caseId}.`,
      });
      await loadEmails();
    } catch (error) {
      setEmailError(error.response?.data?.error || error.message || 'Failed to move email');
    }
  };

  const markEmailNotRelevant = async (messageId) => {
    try {
      await updateCaseEmail(caseId, messageId, {
        needsReview: false,
        classification: 'not_relevant',
        sourceReason: `Marked not relevant for ${caseId}.`,
      });
      await loadEmails();
    } catch (error) {
      setEmailError(error.response?.data?.error || error.message || 'Failed to update email');
    }
  };

  return (
    <div className="case-detail-page page-enter" style={{ '--case-color': caseColor }}>
      <div className="case-detail-hero card">
        <button className="btn-ghost" type="button" onClick={onBack}>
          <ArrowLeft size={15} /> Back to cases
        </button>
        <div className="case-detail-title">
          <p className="case-folder-kicker">Case workspace</p>
          <h2>{caseTitle}</h2>
          <div className="case-detail-meta-row">
            <span className="case-folder-number">{caseId}</span>
            <span className="badge badge-active">{statusLabel(status)}</span>
            <span className={primaryMood.className}>{primaryMood.label}</span>
          </div>
        </div>
        <div className="case-detail-actions">
          <select
            className="input"
            value={status}
            onChange={(event) => onStatusChange(caseId, event.target.value)}
            aria-label="Case status"
          >
            <option value="active">In progress</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
          </select>
          <button className="btn-ghost" type="button" onClick={() => onStatusChange(caseId, 'active')}>
            <RefreshCcw size={14} /> Mark active
          </button>
          {caseItem.htmlLink ? (
            <a href={caseItem.htmlLink} target="_blank" rel="noreferrer" className="btn-ghost">
              <ExternalLink size={14} /> Google event
            </a>
          ) : null}
          <button className="btn-danger" type="button" onClick={() => onDelete(caseId)}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      <div className="case-detail-grid">
        <section className="card case-detail-panel case-detail-calendar-panel">
          <div className="case-detail-panel-head">
            <h3><CalendarDays size={17} /> Calendar & due deadline</h3>
          </div>
          <div className="case-detail-deadline-large">
            <span>Next active deadline</span>
            <strong>{formatShortDate(primaryDeadline)}</strong>
            <em>{primaryDeadlineRow ? primaryMood.label : 'No upcoming deadline detected'}</em>
            {primaryDeadlineRow?.action ? <small>{primaryDeadlineRow.action}</small> : null}
          </div>
          <div className="case-summary-grid case-detail-summary-grid">
            <div className="case-summary-item">
              <span>Proof of Service</span>
              <strong>{formatShortDate(caseItem.proofServiceDate)}</strong>
              <small>{caseItem.proofServiceMethod || 'method unknown'}</small>
            </div>
            <div className="case-summary-item">
              <span>Discovery sets</span>
              <strong>{discoverySets}</strong>
              <small>Detected from email and attachments</small>
            </div>
            <div className="case-summary-item">
              <span>Source</span>
              <strong>{caseItem.triggerName || 'Manual case folder'}</strong>
              <small>{caseItem.sourceAccount || caseItem.sourceCalendarId || 'CaseSync'}</small>
            </div>
          </div>
          <div className="case-calendar-controls">
            <div className="case-detail-section-title">
              <h4>Calendar controls</h4>
              {settingsSaving ? <span className="hint-chip">Saving...</span> : <span className="hint-chip">User controlled</span>}
            </div>
            <label className="case-setting-toggle">
              <input
                type="checkbox"
                checked={caseSettings.calendarAutoEnabled}
                onChange={(event) => saveCaseSettings({ calendarAutoEnabled: event.target.checked })}
              />
              <span>
                <strong>Auto-update Google Calendar</strong>
                <small>When on, confirmed deadline packages can update Google Calendar automatically.</small>
              </span>
            </label>
            <label className="case-setting-toggle">
              <input
                type="checkbox"
                checked={caseSettings.reviewBeforeCalendarUpdate}
                onChange={(event) => saveCaseSettings({ reviewBeforeCalendarUpdate: event.target.checked })}
              />
              <span>
                <strong>Review before calendar update</strong>
                <small>When on, CaseSync saves the email and deadline but holds calendar changes for review.</small>
              </span>
            </label>
          </div>
          <div className="case-detail-deadline-list">
            <div className="case-detail-section-title">
              <h4>Upcoming deadlines</h4>
              <span className="hint-chip">{upcomingDeadlineRows.length} active</span>
            </div>
            {upcomingDeadlineRows.length === 0 ? (
              <p className="meta">No upcoming deadlines detected. Past detections are kept in history below.</p>
            ) : upcomingDeadlineRows.map((item) => {
              const mood = deadlineMood(item.date);
              return (
                <div className="case-detail-deadline-row" key={`${item.date}-${item.action}`}>
                  <div>
                    <strong>{formatShortDate(item.date)}</strong>
                    <p>{item.action || 'Review deadline'}</p>
                    <small>Source: linked email/calendar package · Sets: {discoverySets}</small>
                    {item.serviceMethodCorrected ? <small>Service method corrected to electronic-service default (+32 days).</small> : null}
                  </div>
                  <span className={mood.className}>{mood.label}</span>
                </div>
              );
            })}
            <details className="case-past-deadlines" open={showPastDeadlines} onToggle={(event) => setShowPastDeadlines(event.currentTarget.open)}>
              <summary>
                <span>Past deadline history</span>
                <em>{pastDeadlineRows.length} hidden by default</em>
              </summary>
              {pastDeadlineRows.length === 0 ? (
                <p className="meta">No past deadlines stored for this case.</p>
              ) : pastDeadlineRows.map((item) => {
                const mood = deadlineMood(item.date);
                return (
                  <div className="case-detail-deadline-row is-past" key={`past-${item.date}-${item.action}`}>
                    <div>
                      <strong>{formatShortDate(item.date)}</strong>
                      <p>{item.action || 'Review deadline'}</p>
                      <small>Historical detection. Kept for audit trail, hidden from active planning.</small>
                    </div>
                    <span className={mood.className}>{mood.label}</span>
                  </div>
                );
              })}
            </details>
          </div>
        </section>

        <section className="card case-detail-panel case-detail-email-panel">
          <div className="case-detail-panel-head">
            <h3><Mail size={17} /> Related emails</h3>
            <span className="hint-chip">{visibleRelatedEmails.length} linked</span>
          </div>
          {emailLoading ? <p className="meta">Loading related emails...</p> : null}
          {emailError ? <div className="case-email-error">{emailError}</div> : null}
          {!emailLoading && !emailError && visibleRelatedEmails.length === 0 ? (
            <div className="case-email-empty">No related emails saved yet. Run a scan to attach matching Gmail messages and attachments.</div>
          ) : null}
          {visibleRelatedEmails.length > 0 ? (
            <div className="case-detail-email-list">
              {visibleRelatedEmails.map((email) => (
                <article className={`case-email-item${email.needsReview ? ' needs-review' : ''}`} key={email.messageId}>
                  <div className="case-email-top">
                    <div>
                      <strong className="case-email-subject">{email.subject}</strong>
                      <div className="meta">{email.fromEmail || 'Unknown sender'} · {formatEmailDate(email.receivedAt)}</div>
                    </div>
                    <div className="case-email-badges">
                      {email.needsReview ? <span className="badge badge-medium">Review needed</span> : null}
                      {typeof email.caseConfidence === 'number' ? <span className="badge badge-low">{email.caseConfidence}%</span> : null}
                      <span className="badge badge-closed">{email.classification}</span>
                    </div>
                  </div>
                  <p className="case-email-preview case-detail-email-preview">{email.bodyPreview || email.snippet || 'No preview available.'}</p>
                  {email.sourceReason ? <div className="meta">{email.sourceReason}</div> : null}
                  {email.raw?.aiAnalysis ? (
                    <details className="case-ai-analysis">
                      <summary>
                        <span>{email.raw.aiAnalysis.usedAi ? 'AI extraction result' : 'Parser extraction result'}</span>
                        <em>{formatParserSource(email.raw.parserSource)}{email.raw.aiAnalysis.model ? ` · ${email.raw.aiAnalysis.model}` : ''}</em>
                      </summary>
                      <div className="case-ai-analysis-grid">
                        <div>
                          <span>Summary</span>
                          <strong>{email.raw.aiAnalysis.summary || email.raw.parsedSummary || 'No summary returned.'}</strong>
                        </div>
                        <div>
                          <span>Case ID</span>
                          <strong>{email.raw.aiAnalysis.extracted?.caseId || email.raw.aiAnalysis.extracted?.caseTitle || 'Not extracted'}</strong>
                        </div>
                        <div>
                          <span>Proof of Service</span>
                          <strong>{formatShortDate(email.raw.aiAnalysis.extracted?.proofServiceDate)}</strong>
                          <small>{email.raw.aiAnalysis.extracted?.proofServiceMethod || 'method unknown'}</small>
                        </div>
                        <div>
                          <span>Discovery sets</span>
                          <strong>{Array.isArray(email.raw.aiAnalysis.extracted?.discoverySets) && email.raw.aiAnalysis.extracted.discoverySets.length ? email.raw.aiAnalysis.extracted.discoverySets.join(', ') : 'Not detected'}</strong>
                        </div>
                        <div>
                          <span>Confidence</span>
                          <strong>{typeof email.raw.aiAnalysis.extracted?.caseConfidence === 'number' ? `${email.raw.aiAnalysis.extracted.caseConfidence}%` : 'Not scored'}</strong>
                        </div>
                        <div>
                          <span>Deadline signal</span>
                          <strong>{email.raw.aiAnalysis.extracted?.hasActionableDeadline ? 'Actionable deadline found' : 'No actionable deadline found'}</strong>
                        </div>
                      </div>
                    </details>
                  ) : null}
                  <div className="case-email-actions">
                    {email.needsReview ? (
                      <button className="btn-success" type="button" onClick={() => markEmailReviewed(email.messageId)}>
                        <CheckCircle2 size={13} /> Mark reviewed
                      </button>
                    ) : null}
                    <button className="btn-ghost" type="button" onClick={() => moveEmailToCase(email.messageId)}>
                      Move to case
                    </button>
                    <button className="btn-ghost" type="button" onClick={() => markEmailNotRelevant(email.messageId)}>
                      Not relevant
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <section className="card case-detail-panel">
        <h3>Summary</h3>
        <p className="meta">{summaryText}</p>
        <details className="case-raw-notes" open>
          <summary>AI extraction history</summary>
          {aiEmailAnalyses.length === 0 ? (
            <p className="meta">No AI extraction results saved yet. New unclear emails will show their AI result here after scanning.</p>
          ) : (
            <div className="case-ai-history">
              {aiEmailAnalyses.slice(0, 8).map((item) => (
                <div className="case-ai-history-row" key={item.messageId}>
                  <strong>{item.analysis.usedAi ? 'AI reviewed' : 'Rule parser reviewed'} · {item.subject}</strong>
                  <span>{formatEmailDate(item.receivedAt)} · {formatParserSource(item.parserSource)}</span>
                  <small>{item.analysis.summary || 'No summary returned.'}</small>
                  {item.analysis.model ? <small>Model: {item.analysis.model}</small> : null}
                </div>
              ))}
            </div>
          )}
        </details>
        <details className="case-raw-notes" open>
          <summary>Calendar update history</summary>
          {caseSettings.calendarUpdateHistory.length === 0 ? (
            <p className="meta">No calendar update history yet.</p>
          ) : (
            <div className="case-update-history">
              {caseSettings.calendarUpdateHistory.slice(0, 8).map((entry, index) => (
                <div className="case-update-history-row" key={`${entry.at || index}-${entry.action || index}`}>
                  <strong>{entry.action || 'Case updated'}</strong>
                  <span>{entry.at ? formatEmailDate(entry.at) : 'Date unknown'}</span>
                  {entry.deadline ? <small>Deadline: {entry.deadline}</small> : null}
                  {entry.detail ? <small>{entry.detail}</small> : null}
                  {entry.source ? <small>Source: {entry.source}</small> : null}
                </div>
              ))}
            </div>
          )}
        </details>
        {caseItem.description ? (
          <details className="case-raw-notes">
            <summary>Full calendar notes</summary>
            <pre>{caseItem.description}</pre>
          </details>
        ) : null}
      </section>
    </div>
  );
}
