import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { useState } from 'react';
import { createManualCase } from '../utils/api';

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANGE_OPTIONS = [
  { key: '7d', label: '7 days', months: 1, summary: 'Quick look at the next week' },
  { key: '30d', label: '30 days', months: 1, summary: 'Month view for the next 30 days' },
  { key: '3m', label: '3 months', months: 3, summary: 'Quarterly planning view' },
  { key: '6m', label: '6 months', months: 6, summary: 'Half-year planning view' },
  { key: '1y', label: '1 year', months: 12, summary: 'Full-year planning view' },
];

const toDateOnly = (value) => {
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

const urgencyFromDiff = (diff) => {
  if (diff <= 0) {
    return { level: 'high', label: 'Overdue', color: 'hsl(0, 86%, 40%)' };
  }
  if (diff <= 3) {
    return { level: 'high', label: 'Due soon', color: 'hsl(2, 84%, 52%)' };
  }
  if (diff <= 14) {
    return { level: 'medium', label: 'Risk', color: 'hsl(32, 98%, 45%)' };
  }
  return { level: 'low', label: 'Tracked', color: 'hsl(148, 65%, 45%)' };
};

const byUrgencyLevel = (a, b) => {
  const rank = { high: 0, medium: 1, low: 2 };
  return (rank[a?.level] ?? 3) - (rank[b?.level] ?? 3);
};

const monthShortLabel = (date) => `${monthNames[date.getMonth()]} ${date.getFullYear()}`;

const getRangeEnd = (today, rangeKey) => {
  switch (rangeKey) {
    case '7d':
      return addDays(today, 7);
    case '3m':
      return addMonths(today, 3);
    case '6m':
      return addMonths(today, 6);
    case '1y':
      return addMonths(today, 12);
    case '30d':
    default:
      return addDays(today, 30);
  }
};

export default function Calendar({ cases = [], accounts = [], onManualCaseCreated }) {
  const [rangeKey, setRangeKey] = useState('30d');
  const [manualForm, setManualForm] = useState({
    accountEmail: '',
    calendarId: 'primary',
    caseId: '',
    caseTitle: '',
    proofServiceDate: '',
    proofServiceMethod: 'electronic',
    discoverySets: 'RFPs',
  });
  const [manualStatus, setManualStatus] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const today = new Date();
  const activeRange = RANGE_OPTIONS.find((item) => item.key === rangeKey) || RANGE_OPTIONS[1];
  const rangeEnd = getRangeEnd(today, activeRange.key);
  const daysWindow = Math.max(0, differenceInCalendarDays(rangeEnd, today));
  const accountOptions = (accounts || []).map((account) => account.email).filter(Boolean);

  const updateManualForm = (field, value) => {
    setManualForm((prev) => ({ ...prev, [field]: value }));
  };

  const submitManualCase = async () => {
    setManualStatus('');
    if (!manualForm.caseId.trim() || !manualForm.proofServiceDate.trim()) {
      setManualStatus('Case ID and Proof of Service date are required.');
      return;
    }

    setManualLoading(true);
    try {
      const discoverySets = manualForm.discoverySets
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      await createManualCase({
        ...manualForm,
        accountEmail: manualForm.accountEmail || accountOptions[0] || '',
        discoverySets,
      });
      setManualStatus('Added to Google Calendar and CaseSync.');
      setManualForm((prev) => ({
        ...prev,
        caseId: '',
        caseTitle: '',
        proofServiceDate: '',
        proofServiceMethod: 'electronic',
        discoverySets: 'RFPs',
      }));
      await onManualCaseCreated?.();
    } catch (error) {
      setManualStatus(error.response?.data?.error || error.message || 'Failed to add calendar entry.');
    } finally {
      setManualLoading(false);
    }
  };

  const grouped = cases.reduce((acc, caseItem) => {
    const deadline = toDateOnly(caseItem.nextDeadline?.date);
    if (!deadline) {
      return acc;
    }

    const diff = differenceInCalendarDays(deadline, today);
    if (diff < 0 || diff > daysWindow) {
      return acc;
    }

    const key = format(deadline, 'yyyy-MM-dd');
    const label = caseItem.caseId || '(No case id)';
    const urgency = urgencyFromDiff(diff);

    acc.set(key, [...(acc.get(key) || []), {
      id: caseItem.caseId || caseItem.id || `id-${acc.size}`,
      label,
      diff,
      urgency,
      caseTitle: caseItem.caseTitle || '',
      status: caseItem.status || 'active',
      triggerName: caseItem.triggerName || '',
    }]);

    return acc;
  }, new Map());

  const entries = [...grouped.entries()]
    .map(([date, items]) => ({
      date,
      parsed: toDateOnly(date),
      items: items.sort((lhs, rhs) => byUrgencyLevel(lhs.urgency, rhs.urgency)),
    }))
    .filter((row) => row.parsed)
    .sort((lhs, rhs) => differenceInCalendarDays(lhs.parsed, rhs.parsed));

  const monthCards = Array.from({ length: activeRange.months }, (_, offset) => {
    const base = addMonths(startOfMonth(today), offset);
    const firstDate = startOfMonth(base);
    const lastDate = endOfMonth(base);
    const startDate = startOfWeek(firstDate, { weekStartsOn: 0 });
    const endDate = endOfWeek(lastDate, { weekStartsOn: 0 });

    const days = [];
    let cursor = startDate;
    while (cursor <= endDate) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }

    return {
      label: monthShortLabel(base),
      days,
      firstDate,
      lastDate,
    };
  });

  const counts = {
    total: entries.length,
    urgent: entries.filter((row) => row.items.some((item) => item.urgency.level === 'high')).length,
    soon: entries.filter((row) => row.items.some((item) => item.diff <= 14)).length,
    withinWindow: entries.length,
  };

  return (
    <div className="page-enter">
      <div className="topbar">
        <div>
          <h2>Response Deadline Calendar</h2>
          <p className="meta">{activeRange.summary}</p>
        </div>
      </div>

      <div className="calendar-toolbar">
        <div className="calendar-range-group" role="tablist" aria-label="Calendar ranges">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`calendar-range-chip${option.key === activeRange.key ? ' is-active' : ''}`}
              onClick={() => setRangeKey(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="calendar-range-summary">
          Showing deadlines from today through {format(rangeEnd, 'MMM d, yyyy')}
        </div>
      </div>

      <div className="card manual-calendar-card">
        <div>
          <h3>Add directly to Google Calendar</h3>
          <p className="meta">Create a Proof of Service response deadline package without waiting for an email scan.</p>
        </div>
        <div className="manual-calendar-grid">
          {accountOptions.length > 0 ? (
            <label className="manual-field">
              <span className="meta">Google account</span>
              <select
                className="input"
                value={manualForm.accountEmail || accountOptions[0] || ''}
                onChange={(event) => updateManualForm('accountEmail', event.target.value)}
              >
                {accountOptions.map((email) => (
                  <option key={email} value={email}>{email}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="manual-field">
            <span className="meta">Case ID</span>
            <input
              className="input"
              value={manualForm.caseId}
              onChange={(event) => updateManualForm('caseId', event.target.value)}
              placeholder="24STCV12345"
            />
          </label>
          <label className="manual-field">
            <span className="meta">Case title</span>
            <input
              className="input"
              value={manualForm.caseTitle}
              onChange={(event) => updateManualForm('caseTitle', event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="manual-field">
            <span className="meta">Proof of Service date</span>
            <input
              className="input"
              type="date"
              value={manualForm.proofServiceDate}
              onChange={(event) => updateManualForm('proofServiceDate', event.target.value)}
            />
          </label>
          <label className="manual-field">
            <span className="meta">Service method</span>
            <select
              className="input"
              value={manualForm.proofServiceMethod}
              onChange={(event) => updateManualForm('proofServiceMethod', event.target.value)}
            >
              <option value="electronic">Electronic (+32 days)</option>
              <option value="personal">Personal (+30 days)</option>
              <option value="mail">Mail (+35 days)</option>
            </select>
          </label>
          <label className="manual-field">
            <span className="meta">Discovery sets</span>
            <input
              className="input"
              value={manualForm.discoverySets}
              onChange={(event) => updateManualForm('discoverySets', event.target.value)}
              placeholder="E-rogs, G-rogs, RFPs, RFAs"
            />
          </label>
          <label className="manual-field">
            <span className="meta">Calendar ID</span>
            <input
              className="input"
              value={manualForm.calendarId}
              onChange={(event) => updateManualForm('calendarId', event.target.value)}
              placeholder="primary"
            />
          </label>
        </div>
        <div className="manual-calendar-actions">
          <button className="btn-primary" type="button" onClick={submitManualCase} disabled={manualLoading}>
            {manualLoading ? 'Adding...' : 'Add to Google Calendar'}
          </button>
          {manualStatus ? <span className="meta">{manualStatus}</span> : null}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="n">{counts.total}</div>
          <div>Cases in view</div>
        </div>
        <div className="stat">
          <div className="n">{counts.urgent}</div>
          <div>Urgent</div>
        </div>
        <div className="stat">
          <div className="n">{counts.soon}</div>
          <div>Due within 14 days</div>
        </div>
        <div className="stat">
          <div className="n">{counts.withinWindow}</div>
          <div>Within selected range</div>
        </div>
      </div>

      <div className="layout-grid two-col" style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="calendar-legend">
            <span className="calendar-legend-item">
              <span className="calendar-dot calendar-dot-high" />
              3 days or less
            </span>
            <span className="calendar-legend-item">
              <span className="calendar-dot calendar-dot-medium" />
              4-14 days
            </span>
            <span className="calendar-legend-item">
              <span className="calendar-dot calendar-dot-low" />
              15-60 days
            </span>
          </div>

          <div className="calendar-months">
            {monthCards.map((month) => (
              <div key={month.label} className="calendar-month">
                <h3>{month.label}</h3>
                <div className="calendar-weekdays">
                  {dayLabels.map((day) => (
                    <div key={day}>{day}</div>
                  ))}
                </div>
                <div className="calendar-grid">
                  {month.days.map((day) => {
                    const key = format(day, 'yyyy-MM-dd');
                    const isCurrentMonth = day >= month.firstDate && day <= month.lastDate;
                    const dayDiff = differenceInCalendarDays(day, today);
                    const isWithinRange = dayDiff >= 0 && dayDiff <= daysWindow;
                    const isToday = format(day, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');
                    const dayItems = grouped.get(key) || [];
                    const dayUrgency = dayItems
                      .map((item) => item.urgency.level)
                      .reduce((acc, value) => {
                        if (acc === 'high' || value === 'high') return 'high';
                        if (acc === 'medium' || value === 'medium') return 'medium';
                        return 'low';
                      }, null);

                    return (
                      <div
                        key={key}
                        className={`calendar-day ${isCurrentMonth && isWithinRange ? '' : 'calendar-day--outside'} ${isToday ? 'calendar-day--today' : ''} ${dayUrgency && isWithinRange ? `calendar-day--${dayUrgency}` : ''}`}
                        title={dayItems.map((item) => `${item.label} (${item.urgency.label})`).join('\n') || 'No deadlines'}
                      >
                        <div className="calendar-day-number">{format(day, 'd')}</div>
                        {dayItems.length > 0 ? (
                          <div className="calendar-day-items">
                            {dayItems.slice(0, 2).map((item) => (
                              <span key={`${key}-${item.id}`} className="calendar-dot-tag">
                                {item.label}
                              </span>
                            ))}
                            {dayItems.length > 2 ? (
                              <span className="calendar-more">+{dayItems.length - 2}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Upcoming deadlines</h3>
          {entries.length === 0 ? (
            <div className="empty-state">
              <h3>No deadline in this range</h3>
              <p className="meta">When deadlines are detected, they will be shown here instantly.</p>
            </div>
          ) : (
            <div className="timeline">
              {entries.slice(0, 10).map((row) => (
                <div key={row.date} className="timeline-item">
                  <div className="timeline-meta">
                    <strong>{row.date}</strong>
                    <span className="meta">{row.items.length} case(s)</span>
                  </div>
                  <div className="tag-row" style={{ marginTop: 8 }}>
                    {row.items.map((item) => (
                      <span
                        key={`${row.date}-${item.id}`}
                        className="badge"
                        style={{
                          backgroundColor: item.urgency.color,
                          color: '#fff',
                        }}
                      >
                        {item.label} · {item.urgency.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
