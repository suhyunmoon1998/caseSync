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

  return (
    <button
      className="card case-folder-card case-status-row"
      type="button"
      onClick={() => onOpen(caseItem.caseId)}
      style={{ '--case-color': caseColor }}
    >
      <span className="case-folder-mark" />
      <span className="case-status-main">
        <span className="case-folder-body">
          <span className="case-folder-kicker">Case name</span>
          <strong>{caseLabel}</strong>
        </span>

        <span className="case-status-cell">
          <small>Case number</small>
          <strong>{caseId}</strong>
        </span>

        <span className="case-status-cell">
          <small>Status</small>
          <strong>{titleCaseStatus(status)}</strong>
        </span>

        <span className="case-status-cell">
          <small>Next deadline</small>
          <strong>{formatDeadline(nextDeadline)}</strong>
          <em>{priority.label}</em>
        </span>

        <span className="case-status-cell case-status-email-count">
          <small>Related emails</small>
          <strong>{relatedEmailCount}</strong>
        </span>
      </span>
    </button>
  );
}
