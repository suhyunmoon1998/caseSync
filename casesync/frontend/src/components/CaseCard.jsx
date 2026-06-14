import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Eye, Mail, Pencil, RefreshCcw, Trash2 } from 'lucide-react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { getCaseEmails, updateCaseEmail } from '../utils/api';

const parseDeadlineDate = (value) => {
  if (!value) {
    return null;
  }

  try {
    return parseISO(String(value));
  } catch {
    return null;
  }
};

const toDisplayDateTime = (deadline) => {
  if (!deadline) {
    return 'No deadline';
  }

  if (!deadline.date) {
    return 'No date';
  }

  if (deadline.time) {
    return `${deadline.date} ${deadline.time}`;
  }

  return deadline.date;
};

const formatEmailDate = (value) => {
  if (!value) {
    return 'Date unknown';
  }

  try {
    return format(parseISO(value), 'yyyy-MM-dd HH:mm');
  } catch {
    return String(value);
  }
};

const urgency = (deadline) => {
  if (!deadline?.date) {
    return {
      bucket: 'badge-low',
      color: 'hsl(140, 48%, 27%)',
      text: 'hsl(150, 55%, 80%)',
      label: 'No deadline',
      progress: 0,
    };
  }

  const target = parseDeadlineDate(deadline.date);
  if (!target) {
    return {
      bucket: 'badge-low',
      color: 'hsl(140, 48%, 27%)',
      text: 'hsl(150, 55%, 80%)',
      label: 'Invalid date format',
      progress: 0,
    };
  }

  const diff = differenceInCalendarDays(target, new Date());
  const clamped = Math.max(0, Math.min(60, diff));
  const progress = clamped === 0 ? 1 : (60 - clamped) / 60;
  const hue = Math.round(120 - 120 * progress);
  const saturation = 88;
  const lightness = Math.round(36 + 14 * (1 - progress));
  const bg = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  const fg = `hsl(${hue}, ${Math.max(68, 100 - 20 * progress)}%, ${Math.min(90, 80 + 10 * (1 - progress))}%)`;

  if (diff <= 0) {
    return { bucket: 'badge-high', color: 'hsl(0, 86%, 40%)', text: 'hsl(0, 92%, 88%)', label: 'Overdue', progress: 1 };
  }
  if (diff <= 3) {
    return { bucket: 'badge-high', color: bg, text: fg, label: `${diff}d left`, progress };
  }
  if (diff <= 14) {
    return { bucket: 'badge-medium', color: bg, text: fg, label: `${diff}d left`, progress };
  }
  if (diff <= 60) {
    return { bucket: 'badge-low', color: bg, text: fg, label: `${diff}d left`, progress };
  }

  return {
    bucket: 'badge-low',
    color: 'hsl(140, 48%, 24%)',
    text: 'hsl(140, 40%, 80%)',
    label: `${diff}d left`,
    progress: 0,
  };
};

const deadlineStyle = (deadline) => {
  const stats = urgency(deadline);
  return {
    className: `badge ${stats.bucket}`,
    style: {
      backgroundColor: stats.color,
      color: stats.text,
    },
    text: stats.label,
    progress: stats.progress,
    color: stats.color,
  };
};

const estimateStyle = (score = null, visible = true) => {
  if (!visible || score === null || Number.isNaN(score)) {
    return null;
  }

  const safe = Math.max(0, Math.min(100, Math.round(score)));
  if (safe >= 80) {
    return { label: `Confidence ${safe}%`, className: 'badge badge-low' };
  }
  if (safe >= 50) {
    return { label: `Confidence ${safe}%`, className: 'badge badge-medium' };
  }
  return { label: `Confidence ${safe}%`, className: 'badge badge-high' };
};

const statusColor = (status) => `badge badge-${status || 'active'}`;

const titleCaseStatus = (status) => {
  if (status === 'active') {
    return 'In progress';
  }
  return status || 'active';
};

export default function CaseCard({
  caseItem,
  expanded,
  showEstimateAtOrAbove = 0,
  onExpand,
  onStatusChange,
  onDelete,
}) {
  const nextDeadline = caseItem.nextDeadline;
  const status = caseItem.status || 'active';
  const caseConfidence = caseItem.caseConfidence;
  const isEstimated = caseItem.isEstimated !== false;
  const hasConfidence = typeof caseConfidence === 'number' && Number.isFinite(caseConfidence);
  const showEstimateBadge = !hasConfidence || showEstimateAtOrAbove <= 0 || caseConfidence >= showEstimateAtOrAbove;
  const est = estimateStyle(caseConfidence, showEstimateBadge);
  const showEstimatedTag = isEstimated && showEstimateBadge;
  const priority = deadlineStyle(nextDeadline);
  const dueText = nextDeadline ? toDisplayDateTime(nextDeadline) : null;
  const progress = priority.progress || 0;
  const caseLabel = caseItem.caseTitle || 'Untitled case';
  const caseId = caseItem.caseId || '(No case ID)';
  const lastUpdatedText = caseItem.lastUpdated ? format(parseISO(caseItem.lastUpdated), 'yyyy-MM-dd HH:mm') : 'None';
  const discoverySets = Array.isArray(caseItem.discoverySets) && caseItem.discoverySets.length
    ? caseItem.discoverySets.join(', ')
    : 'Not detected';
  const summaryText = caseItem.summary && !caseItem.summary.startsWith(`[${caseId}]`)
    ? caseItem.summary
    : 'Proof of Service deadline package detected and added to Calendar.';
  const fullNotes = caseItem.description || '';
  const [relatedEmails, setRelatedEmails] = useState([]);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  const reloadEmails = async () => {
    if (!caseItem.caseId) {
      setRelatedEmails([]);
      return;
    }

    setEmailLoading(true);
    setEmailError('');
    try {
      const emails = await getCaseEmails(caseItem.caseId);
      setRelatedEmails(emails);
    } catch (error) {
      setEmailError(error.response?.data?.error || error.message || 'Failed to load related emails');
    } finally {
      setEmailLoading(false);
    }
  };

  useEffect(() => {
    if (!expanded) {
      return undefined;
    }

    let cancelled = false;
    const load = async () => {
      if (!caseItem.caseId) {
        setRelatedEmails([]);
        return;
      }

      setEmailLoading(true);
      setEmailError('');
      try {
        const emails = await getCaseEmails(caseItem.caseId);
        if (!cancelled) {
          setRelatedEmails(emails);
        }
      } catch (error) {
        if (!cancelled) {
          setEmailError(error.response?.data?.error || error.message || 'Failed to load related emails');
        }
      } finally {
        if (!cancelled) {
          setEmailLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [expanded, caseItem.caseId]);

  const markEmailReviewed = async (messageId) => {
    try {
      await updateCaseEmail(caseItem.caseId, messageId, {
        needsReview: false,
        classification: 'reviewed',
        sourceReason: 'Reviewed manually in CaseSync.',
      });
      await reloadEmails();
    } catch (error) {
      setEmailError(error.response?.data?.error || error.message || 'Failed to update email');
    }
  };

  const moveEmailToCase = async (messageId) => {
    const nextCaseId = window.prompt('Move this email to which case ID?', caseItem.caseId);
    if (!nextCaseId || nextCaseId.trim() === caseItem.caseId) {
      return;
    }

    try {
      await updateCaseEmail(caseItem.caseId, messageId, {
        caseId: nextCaseId.trim(),
        needsReview: false,
        classification: 'manual',
        sourceReason: `Moved manually from ${caseItem.caseId}.`,
      });
      await reloadEmails();
    } catch (error) {
      setEmailError(error.response?.data?.error || error.message || 'Failed to move email');
    }
  };

  return (
    <div
      className="card"
      style={{
        position: 'relative',
        borderLeft: `6px solid ${priority.color}`,
      }}
    >
      <div className="case-card__header">
        <div>
          <h3>{caseId}</h3>
          <p className="meta">{caseLabel}</p>
        </div>
        <div className="case-card__header-meta">
          <span className={statusColor(status)}>{titleCaseStatus(status)}</span>
          {est ? <span className={est.className}>{est.label}</span> : null}
          {showEstimatedTag ? <span className="badge badge-medium">Estimated</span> : null}
        </div>
      </div>

      <div className="case-card__deadline">
        <div className="case-card__deadline-row">
          <span className={priority.className} style={priority.style}>
            {priority.text}
          </span>
          <span className="meta">
            {dueText || 'No deadline yet'}
          </span>
        </div>
        <div className="case-deadline-track" style={{
          '--deadline-progress': `${Math.round(progress * 100)}%`,
          '--deadline-color': priority.color,
        }}>
          <span />
        </div>
      </div>

      <div className="case-card__meta">
        <div className="meta">{caseItem.triggerName || 'No trigger set'}</div>
        <div className="meta">Last updated {lastUpdatedText}</div>
      </div>

      <div className="case-card__actions">
        <button className="btn-ghost" onClick={() => onExpand(caseItem.id)}>
          {expanded ? <Eye size={14} /> : <Pencil size={14} />}
          <span>{expanded ? 'Hide details' : 'View details'}</span>
        </button>
        <button className="btn-danger" onClick={() => onDelete(caseItem.caseId)}>
          <Trash2 size={14} />
          <span>Delete</span>
        </button>
      </div>

      {expanded ? (
        <div className="case-card__section">
          <div className="case-summary-grid">
            <div className="case-summary-item">
              <span>Proof of Service</span>
              <strong>{caseItem.proofServiceDate || 'Not detected'}</strong>
              <small>{caseItem.proofServiceMethod || 'method unknown'}</small>
            </div>
            <div className="case-summary-item">
              <span>Response deadline</span>
              <strong>{caseItem.responseDeadlineDate || dueText || 'Not detected'}</strong>
              <small>California discovery response deadline</small>
            </div>
            <div className="case-summary-item">
              <span>Discovery sets</span>
              <strong>{discoverySets}</strong>
              <small>Detected from email text</small>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <h4 style={{ margin: '0 0 6px 0' }}>Deadlines</h4>
            <div className="timeline">
              {(caseItem.deadlines || []).length === 0 ? (
                <div className="meta">No deadline details available.</div>
              ) : (
                caseItem.deadlines.map((item) => (
                  <div className="timeline-item" key={`${item.date}-${item.time || 'all'}-${item.action}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div>
                        <strong>{item.date}</strong>
                        {item.time ? <span className="meta">{` ${item.time}`}</span> : null}
                        <div>{item.action}</div>
                      </div>
                      <span className={`badge badge-${item.priority || 'medium'}`}>{item.priority || 'medium'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ marginBottom: 12 }} className="case-card__section">
            <h4 style={{ margin: '0 0 6px 0' }}>Summary</h4>
            <div className="meta">{summaryText}</div>
          </div>

          <div className="case-card__section case-emails">
            <div className="case-emails__head">
              <h4>
                <Mail size={15} />
                Related emails
              </h4>
              <span className="hint-chip">{relatedEmails.length} linked</span>
            </div>

            {emailLoading ? (
              <div className="meta">Loading related emails...</div>
            ) : null}

            {emailError ? (
              <div className="case-email-error">{emailError}</div>
            ) : null}

            {!emailLoading && !emailError && relatedEmails.length === 0 ? (
              <div className="case-email-empty">
                No related emails saved yet. Run a scan to attach matched Gmail messages to this case.
              </div>
            ) : null}

            {relatedEmails.length > 0 ? (
              <div className="case-email-list">
                {relatedEmails.map((email) => (
                  <article
                    className={`case-email-item${email.needsReview ? ' needs-review' : ''}`}
                    key={email.messageId}
                  >
                    <div className="case-email-top">
                      <div>
                        <strong className="case-email-subject">{email.subject}</strong>
                        <div className="meta">
                          {email.fromEmail || 'Unknown sender'} · {formatEmailDate(email.receivedAt)}
                        </div>
                      </div>
                      <div className="case-email-badges">
                        {email.needsReview ? <span className="badge badge-medium">Review needed</span> : null}
                        {typeof email.caseConfidence === 'number' ? (
                          <span className="badge badge-low">{email.caseConfidence}%</span>
                        ) : null}
                        <span className="badge badge-closed">{email.classification}</span>
                      </div>
                    </div>

                    <p className="case-email-preview">
                      {email.bodyPreview || email.snippet || 'No preview available.'}
                    </p>

                    {email.sourceReason ? (
                      <div className="meta">{email.sourceReason}</div>
                    ) : null}

                    <div className="case-email-actions">
                      {email.needsReview ? (
                        <button className="btn-success" type="button" onClick={() => markEmailReviewed(email.messageId)}>
                          <CheckCircle2 size={13} />
                          Mark reviewed
                        </button>
                      ) : null}
                      <button className="btn-ghost" type="button" onClick={() => moveEmailToCase(email.messageId)}>
                        Move to case
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          {fullNotes ? (
            <details className="case-raw-notes">
              <summary>Full calendar notes</summary>
              <pre>{fullNotes}</pre>
            </details>
          ) : null}

          <div style={{ display: 'grid', gap: 8 }}>
            <label className="meta" htmlFor={`case-status-${caseItem.id}`}>Status</label>
            <select
              id={`case-status-${caseItem.id}`}
              className="input"
              value={status}
              onChange={(event) => onStatusChange(caseItem.caseId, event.target.value)}
            >
              <option value="active">In progress</option>
              <option value="pending">Pending</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {caseItem.htmlLink ? (
            <a href={caseItem.htmlLink} target="_blank" rel="noreferrer" className="btn-ghost" style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ExternalLink size={14} /> Open calendar
            </a>
          ) : null}

          {caseItem.sourceCalendarId ? <div className="meta">Calendar: {caseItem.sourceCalendarId}</div> : null}

          <div className="case-card__actions">
            <button
              className="btn-ghost"
              onClick={() => onStatusChange(caseItem.caseId, 'active')}
              title="Touch for quick refresh"
            >
              <RefreshCcw size={12} />
              <span>Mark active</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
