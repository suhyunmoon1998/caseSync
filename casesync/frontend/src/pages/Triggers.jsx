import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Save } from 'lucide-react';
import TriggerCard from '../components/TriggerCard';
import {
  getTriggers,
  createTrigger,
  updateTrigger,
  deleteTrigger,
  toggleTrigger,
  getCalendars,
} from '../utils/api';

const tagFromText = (value = '') => {
  const trimmed = value.trim();
  return trimmed ? trimmed : '';
};

export default function Triggers({ accounts, onSaved }) {
  const [triggers, setTriggers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [senderDraft, setSenderDraft] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');
  const [patternDraft, setPatternDraft] = useState('');
  const [senderEmails, setSenderEmails] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [caseIdPatterns, setCaseIdPatterns] = useState([]);
  const [calendarId, setCalendarId] = useState('primary');
  const [calendarEmail, setCalendarEmail] = useState('');
  const [calendars, setCalendars] = useState([]);
  const [enabled, setEnabled] = useState(true);

  const accountOptions = useMemo(() => (accounts || []).map((account) => account.email).filter(Boolean), [accounts]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await getTriggers();
      setTriggers(next);
      await onSaved?.();
    } catch {
      setError('Failed to load triggers');
    } finally {
      setLoading(false);
    }
  }, [onSaved]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const primary = accountOptions[0] || '';
    if (!calendarEmail && primary) {
      setCalendarEmail(primary);
      setCalendarId('primary');
    }
  }, [accountOptions, calendarEmail]);

  useEffect(() => {
    const load = async () => {
      if (!calendarEmail) {
        setCalendars([]);
        return;
      }
      try {
        const values = await getCalendars(calendarEmail);
        setCalendars(values);
      } catch {
        setCalendars([]);
      }
    };

    void load();
  }, [calendarEmail]);

  const resetForm = () => {
    setEditing(null);
    setName('');
    setSenderDraft('');
    setKeywordDraft('');
    setPatternDraft('');
    setSenderEmails([]);
    setKeywords([]);
    setCaseIdPatterns([]);
    setEnabled(true);
    const primary = accountOptions[0];
    setCalendarEmail(primary || '');
    setCalendarId('primary');
  };

  const startEdit = (trigger) => {
    setEditing(trigger.id);
    setName(trigger.name || '');
    setSenderEmails(Array.isArray(trigger.senderEmails) ? trigger.senderEmails : []);
    setKeywords(Array.isArray(trigger.keywords) ? trigger.keywords : []);
    setCaseIdPatterns(Array.isArray(trigger.caseIdPatterns) ? trigger.caseIdPatterns : []);
    setCalendarId(trigger.calendarId || 'primary');
    setEnabled(trigger.enabled !== false);
    setSenderDraft('');
    setKeywordDraft('');
    setPatternDraft('');
    setCalendarEmail(accountOptions[0] || '');
  };

  const addTag = (setter, value) => {
    const cleaned = tagFromText(value);
    if (!cleaned) {
      return;
    }
    setter((prev) => (prev.includes(cleaned) ? prev : [...prev, cleaned]));
  };

  const removeTag = (setter, value) => {
    setter((prev) => prev.filter((item) => item !== value));
  };

  const submit = async () => {
    setError('');

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (!senderEmails.length && !keywords.length) {
      setError('At least one sender OR keyword is required');
      return;
    }

    const payload = {
      name: name.trim(),
      senderEmails,
      keywords,
      caseIdPatterns,
      calendarId,
      enabled,
    };

    setLoading(true);
    try {
      if (editing) {
        await updateTrigger(editing, payload);
      } else {
        await createTrigger(payload);
      }
      resetForm();
      await refresh();
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to save trigger');
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm('Delete this trigger?')) {
      return;
    }
    setLoading(true);
    try {
      await deleteTrigger(id);
      await refresh();
      if (editing === id) {
        resetForm();
      }
    } catch {
      setError('Failed to delete trigger');
    } finally {
      setLoading(false);
    }
  };

  const onToggle = async (id) => {
    try {
      await toggleTrigger(id);
      await refresh();
    } catch {
      setError('Failed to toggle trigger');
    }
  };

  const onEdit = (trigger) => {
    if (editing === trigger.id) {
      resetForm();
      return;
    }
    startEdit(trigger);
  };

  return (
    <div>
      <div className="topbar">
        <h2>Triggers</h2>
        <button className="btn-primary" onClick={() => {
          resetForm();
        }}>New rule</button>
      </div>

      {error ? <div className="toast">{error}</div> : null}

      <div className="layout-grid two-col trigger-editor-grid">
        <div className="card">
          <h3>{editing ? 'Edit trigger' : 'New trigger'}</h3>
          <label className="meta" htmlFor="trigger-name">Name</label>
          <input
            id="trigger-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Proof of service"
          />

          <label className="meta" htmlFor="trigger-send">Sender emails</label>
          <div className="form-row">
            <input
              id="trigger-send"
              className="input"
              value={senderDraft}
              onChange={(event) => setSenderDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  addTag(setSenderEmails, senderDraft);
                  setSenderDraft('');
                }
              }}
              placeholder="Enter sender email and press Enter"
            />
            <button className="btn-ghost" onClick={() => {
              addTag(setSenderEmails, senderDraft);
              setSenderDraft('');
            }}>
              Add
            </button>
          </div>
          <div className="tag-row">
            {senderEmails.map((item) => (
              <span className="tag" key={`sender-${item}`}>
                {item}
                <button onClick={() => removeTag(setSenderEmails, item)}><span>×</span></button>
              </span>
            ))}
          </div>

          <label className="meta" htmlFor="trigger-keyword">Keywords</label>
          <div className="form-row">
            <input
              id="trigger-keyword"
              className="input"
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  addTag(setKeywords, keywordDraft);
                  setKeywordDraft('');
                }
              }}
              placeholder="e.g. Proof of Service"
            />
            <button className="btn-ghost" onClick={() => {
              addTag(setKeywords, keywordDraft);
              setKeywordDraft('');
            }}>
              Add
            </button>
          </div>
          <div className="tag-row">
            {keywords.map((item) => (
              <span className="tag" key={`keyword-${item}`}>
                {item}
                <button onClick={() => removeTag(setKeywords, item)}><span>×</span></button>
              </span>
            ))}
          </div>

          <label className="meta" htmlFor="trigger-pattern">Case ID regex patterns</label>
          <div className="form-row">
            <input
              id="trigger-pattern"
              className="input"
              value={patternDraft}
              onChange={(event) => setPatternDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  addTag(setCaseIdPatterns, patternDraft);
                  setPatternDraft('');
                }
              }}
              placeholder="regex pattern"
            />
            <button className="btn-ghost" onClick={() => {
              addTag(setCaseIdPatterns, patternDraft);
              setPatternDraft('');
            }}>
              Add
            </button>
          </div>
          <div className="tag-row">
            {caseIdPatterns.map((item) => (
              <span className="tag" key={`pattern-${item}`}>
                {item}
                <button onClick={() => removeTag(setCaseIdPatterns, item)}><span>×</span></button>
              </span>
            ))}
          </div>

          <label className="meta" htmlFor="trigger-calendar">Target calendar</label>
          <div className="form-row">
            {accountOptions.length ? (
              <select
                className="input"
                value={calendarEmail}
                onChange={(event) => setCalendarEmail(event.target.value)}
              >
                {accountOptions.map((email) => (
                  <option key={email} value={email}>{email}</option>
                ))}
              </select>
            ) : null}
            <select
              className="input"
              value={calendarId}
              onChange={(event) => setCalendarId(event.target.value)}
            >
              {calendars.length ? calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>{calendar.summary || calendar.id}</option>
              )) : (
                <option value="primary">primary</option>
              )}
            </select>
          </div>
          <div className="meta" style={{ marginBottom: 8 }}>
            Pattern note: regex is applied to subject + body + sender.
          </div>

          <div className="form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              Enabled
            </label>
          </div>

          <button className="btn-primary" onClick={submit} disabled={loading}>
            <Save size={14} style={{ marginRight: 6 }} />
            {editing ? 'Save' : 'Create'}
          </button>
          {editing ? (
            <button className="btn-ghost" onClick={resetForm} disabled={loading} style={{ marginLeft: 8 }}>
              Cancel
            </button>
          ) : null}
        </div>

        <div className="card">
          <h3>Accounts and calendars</h3>
          <div className="meta">Connected accounts: {(accounts || []).length}</div>
          {accountOptions.length === 0 ? <div className="meta">Connect Google account first.</div> : null}
          {accountOptions.map((email) => (
            <div key={email} style={{ marginBottom: 8 }} className="account-chip">{email}</div>
          ))}
          <button className="btn-ghost" onClick={() => setCalendarEmail(accountOptions[0] || '')}>
            <CalendarClock size={14} style={{ marginRight: 6 }} />
            Reload calendars
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Trigger list</h3>
        <div className="layout-grid" style={{ gridTemplateColumns: '1fr' }}>
          {loading ? <div className="meta">Loading triggers...</div> : null}
          {triggers.map((trigger) => (
            <TriggerCard
              key={trigger.id}
              trigger={trigger}
              onToggle={() => onToggle(trigger.id)}
              onEdit={() => onEdit(trigger)}
              onDelete={() => onDelete(trigger.id)}
            />
          ))}
          {!loading && triggers.length === 0 ? <div className="meta">No triggers yet.</div> : null}
        </div>
      </div>
    </div>
  );
}
