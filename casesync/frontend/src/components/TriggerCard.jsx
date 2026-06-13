import { Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';

export default function TriggerCard({ trigger, onToggle, onEdit, onDelete }) {
  const senderCount = (trigger.senderEmails || []).length;
  const keywordCount = (trigger.keywords || []).length;
  const isEnabled = trigger.enabled !== false;

  return (
    <div className={`card trigger-card ${isEnabled ? 'trigger-card-active' : 'trigger-card-paused'}`}>
      <div className="trigger-card-head">
        <div className="trigger-card-title">
          <span className={`status-pill ${isEnabled ? 'status-success' : 'status-muted'}`}>
            {isEnabled ? 'Active' : 'Paused'}
          </span>
          <h3>{trigger.name}</h3>
          <div className="meta">
            target: <strong>{trigger.calendarId || 'primary'}</strong>
          </div>
        </div>
        <div className="trigger-card-actions">
          <button
            className="btn-ghost icon-button"
            onClick={() => onToggle(trigger.id)}
            aria-label={isEnabled ? 'Pause trigger' : 'Activate trigger'}
            title={isEnabled ? 'Pause trigger' : 'Activate trigger'}
          >
            {isEnabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          </button>
          <button
            className="btn-ghost icon-button"
            onClick={() => onEdit(trigger)}
            aria-label="Edit trigger"
            title="Edit trigger"
          >
            <Pencil size={14} />
          </button>
          <button
            className="btn-danger icon-button"
            onClick={() => onDelete(trigger.id)}
            aria-label="Delete trigger"
            title="Delete trigger"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="tag-row trigger-tag-row">
        {(trigger.senderEmails || []).map((item) => <span className="tag" key={`sender-${item}`}>{item}</span>)}
      </div>
      <div className="tag-row trigger-tag-row">
        {(trigger.keywords || []).map((item) => <span className="tag" key={`keyword-${item}`}>{item}</span>)}
      </div>
      <div className="tag-row trigger-tag-row">
        {(trigger.caseIdPatterns || []).map((item) => <span className="tag" key={`pattern-${item}`}>{item}</span>)}
      </div>
      <div className="meta trigger-card-meta">
        Matched: sender({senderCount}) / keyword({keywordCount})
      </div>
    </div>
  );
}
