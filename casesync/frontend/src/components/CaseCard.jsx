import { ExternalLink, Eye, Pencil, RefreshCcw, Trash2 } from 'lucide-react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';

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
