import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CalendarClock, Save, Send, Sparkles, Wand2 } from 'lucide-react';
import TriggerCard from '../components/TriggerCard';
import {
  getTriggers,
  createTrigger,
  suggestTrigger,
  updateTrigger,
  deleteTrigger,
  toggleTrigger,
  getCalendars,
} from '../utils/api';

const tagFromText = (value = '') => {
  const trimmed = value.trim();
  return trimmed ? trimmed : '';
};

export default function Triggers({ accounts, onSaved, onRunScan }) {
  const [triggers, setTriggers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState(null);
  const [assistantMessages, setAssistantMessages] = useState([
    {
      role: 'assistant',
      text: 'Tell me what emails CaseSync should watch. I will draft the trigger, then you can create it and scan inboxes for calendar review.',
    },
  ]);

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
    } catch {
      setError('Failed to load triggers');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const applyDraftToForm = (draft = {}) => {
    setEditing(null);
    setName(draft.name || '');
    setSenderEmails(Array.isArray(draft.senderEmails) ? draft.senderEmails : []);
    setKeywords(Array.isArray(draft.keywords) ? draft.keywords : []);
    setCaseIdPatterns(Array.isArray(draft.caseIdPatterns) ? draft.caseIdPatterns : []);
    setCalendarId(draft.calendarId || 'primary');
    setCalendarEmail(draft.accountEmail || accountOptions[0] || '');
    setEnabled(draft.enabled !== false);
    setSenderDraft('');
    setKeywordDraft('');
    setPatternDraft('');
  };

  const askAssistant = async (messageOverride = '') => {
    const message = String(messageOverride || assistantInput || '').trim();
    if (!message) {
      return;
    }

    setAssistantInput('');
    setAssistantLoading(true);
    setError('');
    setAssistantMessages((prev) => [...prev, { role: 'user', text: message }]);

    try {
      const result = await suggestTrigger({
        message,
        accountEmails: accountOptions,
      });
      const draft = result.trigger || null;
      if (draft) {
        setAssistantDraft(draft);
        applyDraftToForm(draft);
      }
      setAssistantMessages((prev) => [...prev, {
        role: 'assistant',
        text: result.reply || 'I drafted a trigger. Review it, then create the rule and scan inboxes.',
        source: result.source,
      }]);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to ask trigger assistant');
      setAssistantMessages((prev) => [...prev, {
        role: 'assistant',
        text: 'I could not draft that trigger yet. Try describing the email type, sender, or deadline you want to catch.',
      }]);
    } finally {
      setAssistantLoading(false);
    }
  };

  const createDraftAndScan = async () => {
    if (!assistantDraft) {
      setError('Ask the assistant to draft a trigger first.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await createTrigger(assistantDraft);
      await refresh();
      await onSaved?.();
      setAssistantMessages((prev) => [...prev, {
        role: 'assistant',
        text: 'Rule created. I am starting a Gmail scan now. Calendar items will stay in review until you approve them.',
      }]);
      await onRunScan?.();
      setAssistantDraft(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create trigger');
    } finally {
      setLoading(false);
    }
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
      await onSaved?.();
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
      await onSaved?.();
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
      await onSaved?.();
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

  const applyDiscoveryPreset = () => {
    setEditing(null);
    setName('Discovery proof of service');
    setSenderEmails([]);
    setKeywords([
      'proof of service',
      'served',
      'discovery',
      'interrogatories',
      'requests for production',
      'requests for admission',
      'E-rogs',
      'G-rogs',
      'RFP',
      'RFA',
    ]);
    setCaseIdPatterns([
      '(?:Case\\s*(?:No\\.?|Number)|Docket\\s*(?:No\\.?|Number))[:#\\s-]*([A-Z0-9-]+)',
      '\\b\\d{2}[A-Z]{2,4}\\d{4,}\\b',
    ]);
    setCalendarId('primary');
    setCalendarEmail(accountOptions[0] || '');
    setEnabled(true);
    setSenderDraft('');
    setKeywordDraft('');
    setPatternDraft('');
  };

  const applyCourtPreset = () => {
    setEditing(null);
    setName('Court / CMC / hearing notices');
    setSenderEmails([]);
    setKeywords([
      'court notice',
      'notice of hearing',
      'hearing notice',
      'case management conference',
      'CMC',
      'case management statement',
      'minute order',
      'notice of ruling',
      'reservation',
      'LASC',
      'eCourt',
      'e-filing',
    ]);
    setCaseIdPatterns([
      '(?:Case\\s*(?:No\\.?|Number)|Docket\\s*(?:No\\.?|Number))[:#\\s-]*([A-Z0-9-]+)',
      '\\b\\d{2}[A-Z]{2,5}\\d{4,}\\b',
      '\\b\\d{7,12}\\b',
    ]);
    setCalendarId('primary');
    setCalendarEmail(accountOptions[0] || '');
    setEnabled(true);
    setSenderDraft('');
    setKeywordDraft('');
    setPatternDraft('');
  };

  const applyVendorPreset = () => {
    setEditing(null);
    setName('Vendor deadline / payment notices');
    setSenderEmails([]);
    setKeywords([
      'invoice',
      'payment due',
      'balance due',
      'past due',
      'subscription',
      'renewal',
      'upload',
      'deadline',
      'transcript',
      'records',
      'vendor',
      'SugarSync',
    ]);
    setCaseIdPatterns([
      '(?:Case\\s*(?:No\\.?|Number)|Docket\\s*(?:No\\.?|Number))[:#\\s-]*([A-Z0-9-]+)',
      '\\b\\d{2}[A-Z]{2,5}\\d{4,}\\b',
      '\\b\\d{7,12}\\b',
    ]);
    setCalendarId('primary');
    setCalendarEmail(accountOptions[0] || '');
    setEnabled(true);
    setSenderDraft('');
    setKeywordDraft('');
    setPatternDraft('');
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Triggers</h2>
          <p className="meta">Rules decide which Gmail messages CaseSync scans for proof dates, discovery sets, and response deadlines.</p>
        </div>
        <div className="trigger-top-actions">
          <button className="btn-ghost" type="button" onClick={applyDiscoveryPreset}>
            Use discovery preset
          </button>
          <button className="btn-ghost" type="button" onClick={applyCourtPreset}>
            Use court/CMC preset
          </button>
          <button className="btn-ghost" type="button" onClick={applyVendorPreset}>
            Use vendor preset
          </button>
          <button className="btn-primary" onClick={() => {
            resetForm();
          }}>New rule</button>
        </div>
      </div>

      {error ? <div className="toast">{error}</div> : null}

      <div className="card trigger-chat-builder">
        <div className="trigger-chat-head">
          <div>
            <span className="eyebrow">AI rule builder</span>
            <h3>Describe the emails. CaseSync will build the trigger.</h3>
            <p className="meta">
              Example: “Watch emails from opposing counsel for proof of service and discovery, then prepare calendar reminders for review.”
            </p>
          </div>
          <span className="ai-cost-pill">
            <Sparkles size={14} />
            Haiku cost-safe
          </span>
        </div>

        <div className="trigger-prompt-row">
          <button className="btn-ghost" type="button" onClick={() => askAssistant('Watch for written discovery served by opposing counsel, including proof of service, interrogatories, RFPs, RFAs, and calculate response deadlines.')}>
            Discovery served
          </button>
          <button className="btn-ghost" type="button" onClick={() => askAssistant('Watch for court notices, CMC notices, hearing notices, minute orders, and case management statement deadlines.')}>
            Court / CMC notices
          </button>
          <button className="btn-ghost" type="button" onClick={() => askAssistant('Watch for vendor emails with invoices, payment due dates, uploads, transcript deadlines, records deadlines, and renewal notices.')}>
            Vendor deadlines
          </button>
        </div>

        <div className="trigger-chat-grid">
          <div className="trigger-chat-window" aria-live="polite">
            {assistantMessages.map((message, index) => (
              <div className={`chat-bubble ${message.role === 'user' ? 'is-user' : 'is-assistant'}`} key={`${message.role}-${index}`}>
                {message.role === 'assistant' ? <Bot size={15} /> : null}
                <span>{message.text}</span>
              </div>
            ))}
            {assistantLoading ? (
              <div className="chat-bubble is-assistant">
                <Bot size={15} />
                <span>Drafting a safe trigger...</span>
              </div>
            ) : null}
          </div>

          <div className="trigger-draft-panel">
            <div className="trigger-draft-title">
              <Wand2 size={16} />
              <strong>Draft trigger</strong>
            </div>
            {!assistantDraft ? (
              <p className="meta">No draft yet. Ask the assistant or choose a quick prompt.</p>
            ) : (
              <>
                <h4>{assistantDraft.name}</h4>
                <div className="trigger-draft-section">
                  <span className="meta">Keywords</span>
                  <div className="tag-row">
                    {(assistantDraft.keywords || []).slice(0, 10).map((item) => (
                      <span className="tag" key={`draft-keyword-${item}`}>{item}</span>
                    ))}
                  </div>
                </div>
                <div className="trigger-draft-section">
                  <span className="meta">Senders</span>
                  <div className="tag-row">
                    {(assistantDraft.senderEmails || []).length ? assistantDraft.senderEmails.map((item) => (
                      <span className="tag" key={`draft-sender-${item}`}>{item}</span>
                    )) : <span className="meta">Any sender matching keywords</span>}
                  </div>
                </div>
                <div className="trigger-draft-section">
                  <span className="meta">Calendar behavior</span>
                  <p className="meta">Creates a scan rule. Calendar items remain review-only until approved.</p>
                </div>
                <button className="btn-primary" type="button" onClick={createDraftAndScan} disabled={loading || assistantLoading}>
                  Create rule + scan inboxes
                </button>
              </>
            )}
          </div>
        </div>

        <div className="trigger-chat-input">
          <input
            className="input"
            value={assistantInput}
            onChange={(event) => setAssistantInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void askAssistant();
              }
            }}
            placeholder="Tell CaseSync what emails to watch, e.g. proof of service from opposing counsel"
          />
          <button className="btn-primary" type="button" onClick={() => askAssistant()} disabled={assistantLoading}>
            <Send size={14} />
            Ask
          </button>
        </div>
      </div>

      <details
        className="advanced-trigger-form"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>Advanced manual rule editor</summary>
        <div className="layout-grid two-col trigger-editor-grid">
        <div className="card">
          <h3>{editing ? 'Edit trigger' : 'New trigger'}</h3>
          <div className="trigger-helper">
            <strong>Recommended first rule</strong>
            <p className="meta">Use the discovery preset, create the trigger, then click Scan now. CaseSync will calculate response deadlines from Proof of Service dates and prepare Calendar reminders for review.</p>
            <button className="btn-ghost" type="button" onClick={applyDiscoveryPreset}>
              Fill recommended discovery trigger
            </button>
            <button className="btn-ghost" type="button" onClick={applyCourtPreset}>
              Fill court / CMC trigger
            </button>
            <button className="btn-ghost" type="button" onClick={applyVendorPreset}>
              Fill vendor trigger
            </button>
          </div>
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
      </details>

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
