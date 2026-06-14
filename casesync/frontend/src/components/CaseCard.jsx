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

  return (
    <button
      className="card case-folder-card"
      type="button"
      onClick={() => onOpen(caseItem.caseId)}
      style={{ '--case-color': caseColor }}
    >
      <span className="case-folder-mark" />
      <span className="case-folder-body">
        <span className="case-folder-kicker">Case folder</span>
        <strong>{caseLabel}</strong>
        <span className="case-folder-number">{caseId}</span>
      </span>
      <span className="case-folder-footer">
        <span className="badge badge-active">{titleCaseStatus(status)}</span>
        <span className="case-folder-hint">{priority.label}</span>
      </span>
    </button>
  );
}
