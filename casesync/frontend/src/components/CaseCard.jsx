import { differenceInCalendarDays, parseISO } from 'date-fns';

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

const urgency = (deadline) => {
  if (!deadline?.date) {
    return {
      color: 'hsl(140, 48%, 27%)',
      label: 'No deadline',
    };
  }

  const target = parseDeadlineDate(deadline.date);
  if (!target) {
    return {
      color: 'hsl(140, 48%, 27%)',
      label: 'Invalid date',
    };
  }

  const diff = differenceInCalendarDays(target, new Date());
  if (diff <= 0) {
    return { color: 'hsl(0, 86%, 40%)', label: 'Overdue' };
  }
  if (diff <= 14) {
    return { color: 'hsl(32, 98%, 45%)', label: `${diff}d left` };
  }
  return { color: 'hsl(148, 65%, 38%)', label: `${diff}d left` };
};

const titleCaseStatus = (status) => (status === 'active' ? 'In progress' : status || 'active');

const formatDeadline = (deadline) => {
  if (!deadline?.date) {
    return 'No deadline';
  }

  return deadline.action ? `${deadline.date} - ${deadline.action}` : deadline.date;
};

export default function CaseCard({
  caseItem,
  onOpen,
}) {
  const nextDeadline = caseItem.nextDeadline;
  const status = caseItem.status || 'active';
  const priority = urgency(nextDeadline);
  const caseLabel = caseItem.caseTitle || 'Untitled case';
  const caseId = caseItem.caseId || '(No case ID)';
  const caseColor = caseItem.caseColor || priority.color;
  const relatedEmailCount = Number(caseItem.relatedEmailCount || 0);
  const relatedEmailReviewCount = Number(caseItem.relatedEmailReviewCount || 0);

  return (
    <button
      className="card case-folder-card case-folder-tile"
      type="button"
      onClick={() => onOpen(caseItem.caseId)}
      style={{ '--case-color': caseColor }}
    >
      <span className="case-folder-tab" />
      <span className="case-folder-mark" />

      <span className="case-folder-tile-head">
        <span className="case-folder-kicker">Case folder</span>
        <span className="badge badge-active">{titleCaseStatus(status)}</span>
      </span>

      <span className="case-folder-body">
        <strong>{caseLabel}</strong>
        <span className="case-folder-number">{caseId}</span>
      </span>

      <span className="case-folder-tile-details">
        <span>
          <small>Next deadline</small>
          <strong>{formatDeadline(nextDeadline)}</strong>
          <em>{priority.label}</em>
        </span>
        <span className="case-folder-email-count">
          <small>Related emails</small>
          <strong>{relatedEmailCount}</strong>
          {relatedEmailReviewCount > 0 ? <em>{relatedEmailReviewCount} review</em> : null}
        </span>
      </span>
    </button>
  );
}
