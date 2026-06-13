import { google } from 'googleapis';

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const normalizePriority = (value) => {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
};

const normalizeTime = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
};

const normalizeDate = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
};

const addDaysIso = (date, days) => {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) {
    return null;
  }

  const parsed = new Date(`${normalizedDate}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const pad = (value) => String(value).padStart(2, '0');

const formatLocalDateTime = (date) => (
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
);

const toDateTime = (date, time) => {
  if (!date) {
    return null;
  }

  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) {
    return null;
  }

  if (!time) {
    return { date: normalizedDate };
  }

  const normalizedTime = normalizeTime(time);
  if (!normalizedTime) {
    return { date: normalizedDate };
  }

  return {
    dateTime: `${normalizedDate}T${normalizedTime}:00`,
    timeZone: localTz,
  };
};

const toEventTimeRange = (date, time = null) => {
  const start = toDateTime(date, time);
  if (!start) {
    return {
      start: { date: new Date().toISOString().slice(0, 10) },
      end: { date: addDaysIso(new Date().toISOString().slice(0, 10), 1) },
    };
  }

  if (start.date) {
    return {
      start,
      end: { date: addDaysIso(start.date, 1) },
    };
  }

  const normalizedDate = normalizeDate(date);
  const normalizedTime = normalizeTime(time);
  const endDate = new Date(`${normalizedDate}T${normalizedTime}:00`);
  endDate.setHours(endDate.getHours() + 1);

  return {
    start,
    end: {
      dateTime: formatLocalDateTime(endDate),
      timeZone: localTz,
    },
  };
};

const buildResponsePackageLines = (responsePackage) => {
  if (!responsePackage?.responseDeadlineDate) {
    return [];
  }

  const lines = [
    '',
    'RESPONSE DEADLINE PACKAGE:',
    `Proof of Service: ${responsePackage.proofServiceDate || 'n/a'} (${responsePackage.proofServiceMethod || 'personal'})`,
    `Last day to serve verified written responses: ${responsePackage.responseDeadlineDate} (+${responsePackage.responseDeadlineDays || 30} days)`,
    `Discovery sets: ${(responsePackage.discoverySets || []).join(', ') || 'Discovery responses'}`,
    '',
    'CALENDAR TASKS:',
  ];

  for (const task of responsePackage.calendarTasks || []) {
    lines.push(`• ${task.date} — ${task.title} [${task.priority || 'medium'}]`);
  }

  lines.push('', 'SKELETON RESPONSE DOCUMENTS:');
  for (const doc of responsePackage.skeletonDocuments || []) {
    lines.push(`• ${doc.title}`);
    lines.push('  General objections: [standard objections preserved for attorney review]');
    lines.push(`  Individual responses: ${doc.individualResponsePlaceholder}`);
    lines.push(`  Verification: ${doc.verification}`);
  }

  lines.push('', 'CLIENT MEETING PREP:');
  lines.push('Questions to ask:');
  for (const question of responsePackage.clientPrep?.questions || []) {
    lines.push(`• ${question}`);
  }
  lines.push('Documents to request:');
  for (const document of responsePackage.clientPrep?.documents || []) {
    lines.push(`• ${document}`);
  }
  lines.push('Verification explanation:');
  for (const explanation of responsePackage.clientPrep?.explanation || []) {
    lines.push(`• ${explanation}`);
  }

  return lines;
};

const buildDescription = (caseId, caseTitle, summary, deadlines, sourceName, sourceEmail, responsePackage = null) => {
  const lines = [
    `📋 CASE: ${caseId}`,
    `📝 ${caseTitle || 'N/A'}`,
    '',
    'SUMMARY:',
    summary || 'No summary provided.',
    '',
    'DEADLINES:',
  ];

  const sortedDeadlines = (deadlines || [])
    .slice()
    .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));

  for (const deadline of sortedDeadlines) {
    const timeText = deadline.time ? ` ${deadline.time}` : '';
    const priorityText = deadline.priority ? ` [${deadline.priority}]` : '';
    lines.push(`• ${deadline.date}${timeText} — ${deadline.action || 'Follow this request'}${priorityText}`);
  }

  if (!sortedDeadlines.length) {
    lines.push('• No deadlines extracted');
  }

  lines.push(...buildResponsePackageLines(responsePackage));

  lines.push('');
  lines.push(`Last updated: ${new Date().toISOString()}`);
  lines.push(`Source: ${sourceName || 'CaseSync'} | ${sourceEmail || 'n/a'}`);

  return lines.join('\n');
};

export const extractDeadlinesFromDescription = (description = '') => {
  const lines = String(description).split('\n');

  return lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('•'))
    .map((line) => {
      const match = line.match(/^•\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\s+—\s+(.+?)(?:\s+\[(high|medium|low)\])?$/);
      if (!match) {
        return null;
      }

      return {
        date: match[1],
        time: normalizeTime(match[2] || null),
        action: (match[3] || 'Follow this request').trim(),
        priority: normalizePriority(match[4]),
      };
    })
    .filter(Boolean);
};

const dedupeDeadlines = (existing = [], append = []) => {
  const map = new Map();

  for (const item of [...(existing || []), ...(append || [])]) {
    if (!item || !normalizeDate(item.date)) {
      continue;
    }
    const key = `${item.date}|${normalizeTime(item.time || '') || ''}|${(item.action || '').trim().toLowerCase()}`;
    map.set(key, {
      date: normalizeDate(item.date),
      time: normalizeTime(item.time) || null,
      action: item.action || 'Follow this request',
      priority: normalizePriority(item.priority),
    });
  }

  return [...map.values()].sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
};

export const findEventByCaseId = async (auth, calendarId, caseId) => {
  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.events.list({
    calendarId,
    privateExtendedProperty: [`casesync=true`, `caseId=${caseId}`],
    maxResults: 20,
  });

  const events = data.items || [];
  return events[0] ? { ...events[0] } : null;
};

export const createCaseEvent = async (auth, calendarId, eventData) => {
  const {
    caseId,
    caseTitle,
    deadlines = [],
    summary = '',
    trigger,
    triggerName,
    emailId,
    sourceEmail,
    sourceName,
    status,
    raw,
    caseConfidence,
    estimated,
    proofServiceDate,
    proofServiceMethod,
    responseDeadlineDate,
    discoverySets,
    responsePackage,
  } = eventData;

  const calendar = google.calendar({ version: 'v3', auth });
  const sortedDeadlines = deadlines.slice().sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
  const first = sortedDeadlines[0] || { date: new Date().toISOString().slice(0, 10), time: null };
  const { start, end } = toEventTimeRange(first.date, first.time);

  const body = {
    summary: `[${caseId}] ${caseTitle}`,
    description: buildDescription(caseId, caseTitle, summary, sortedDeadlines, triggerName || sourceName, sourceEmail, responsePackage),
    start,
    end,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 * 24 * 14 },
        { method: 'popup', minutes: 60 * 24 * 7 },
        { method: 'popup', minutes: 60 * 24 },
      ],
    },
    extendedProperties: {
      private: {
        casesync: 'true',
        caseId,
        triggerId: trigger?.id || trigger,
        triggerName: triggerName || trigger?.name || 'CaseSync',
        lastEmailId: emailId || raw?.id || '',
        lastUpdated: new Date().toISOString(),
        status: status || 'active',
        caseConfidence: String(caseConfidence ?? ''),
        estimated: estimated ? 'true' : 'false',
        proofServiceDate: proofServiceDate || '',
        proofServiceMethod: proofServiceMethod || '',
        responseDeadlineDate: responseDeadlineDate || '',
        discoverySets: (discoverySets || responsePackage?.discoverySets || []).join(', '),
      },
    },
  };

  const result = await calendar.events.insert({
    calendarId,
    requestBody: body,
  });

  return result.data;
};

export const updateCaseEvent = async (auth, calendarId, eventId, eventData) => {
  const calendar = google.calendar({ version: 'v3', auth });
  const current = await calendar.events.get({
    calendarId,
    eventId,
  });
  const existing = current.data || {};

  const mergedDeadlines = dedupeDeadlines(
    extractDeadlinesFromDescription(existing.description || ''),
    eventData.deadlines || [],
  );

  const summaryTitle = eventData.caseTitle ? `[${eventData.caseId}] ${eventData.caseTitle}` : existing.summary;
  const first = mergedDeadlines[0] || null;
  const eventRange = first
    ? toEventTimeRange(first.date, first.time)
    : {
      start: existing.start || { date: new Date().toISOString().slice(0, 10) },
      end: existing.end || { date: addDaysIso(new Date().toISOString().slice(0, 10), 1) },
    };

  const patch = {
    ...existing,
    summary: summaryTitle,
    description: buildDescription(
      eventData.caseId || existing.extendedProperties?.private?.caseId || '',
      eventData.caseTitle || existing.summary?.replace(/^\[[^\]]+\]\s*/, ''),
      eventData.summary || existing.summary,
      mergedDeadlines,
      eventData.sourceName || eventData.triggerName,
      eventData.sourceEmail,
      eventData.responsePackage,
    ),
    start: eventRange.start,
    end: eventRange.end,
    reminders: existing.reminders || {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 * 24 * 14 },
        { method: 'popup', minutes: 60 * 24 * 7 },
        { method: 'popup', minutes: 60 * 24 },
      ],
    },
    extendedProperties: {
      ...(existing.extendedProperties || {}),
      private: {
        ...(existing.extendedProperties?.private || {}),
        casesync: 'true',
        caseId: eventData.caseId || existing.extendedProperties?.private?.caseId || '',
        triggerId: eventData.trigger?.id || eventData.trigger || existing.extendedProperties?.private?.triggerId || '',
        triggerName: eventData.triggerName || eventData.sourceName || existing.extendedProperties?.private?.triggerName || 'CaseSync',
        status: eventData.status || existing.extendedProperties?.private?.status || 'active',
        lastUpdated: new Date().toISOString(),
        lastEmailId: eventData.emailId || existing.extendedProperties?.private?.lastEmailId || '',
        caseConfidence: Number.isFinite(Number(eventData.caseConfidence))
          ? String(Number(eventData.caseConfidence))
          : existing.extendedProperties?.private?.caseConfidence || '',
        estimated: eventData.estimated === undefined
          ? existing.extendedProperties?.private?.estimated
          : eventData.estimated
            ? 'true'
            : 'false',
        proofServiceDate: eventData.proofServiceDate || existing.extendedProperties?.private?.proofServiceDate || '',
        proofServiceMethod: eventData.proofServiceMethod || existing.extendedProperties?.private?.proofServiceMethod || '',
        responseDeadlineDate: eventData.responseDeadlineDate || existing.extendedProperties?.private?.responseDeadlineDate || '',
        discoverySets: (eventData.discoverySets || eventData.responsePackage?.discoverySets || []).join(', ')
          || existing.extendedProperties?.private?.discoverySets
          || '',
      },
    },
  };

  const response = await calendar.events.update({
    calendarId,
    eventId,
    requestBody: patch,
  });

  return response.data;
};

const findRelatedCaseEvent = async (auth, calendarId, caseId, role) => {
  if (!caseId || !role) {
    return null;
  }

  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.events.list({
    calendarId,
    privateExtendedProperty: [
      'casesyncRelated=true',
      `caseId=${caseId}`,
      `caseEventRole=${role}`,
    ],
    maxResults: 10,
  });

  return data.items?.[0] || null;
};

const buildRelatedDescription = (caseId, task, eventData, primaryEvent) => [
  `CaseSync related event for case ${caseId}`,
  '',
  `Task: ${task.action || task.title}`,
  `Priority: ${task.priority || 'medium'}`,
  `Primary calendar event: ${primaryEvent?.htmlLink || 'n/a'}`,
  '',
  eventData.responsePackage?.responseDeadlineDate
    ? `Response deadline: ${eventData.responsePackage.responseDeadlineDate}`
    : null,
  eventData.responsePackage?.proofServiceDate
    ? `Proof of Service: ${eventData.responsePackage.proofServiceDate}`
    : null,
].filter(Boolean).join('\n');

export const upsertRelatedCaseEvents = async (auth, calendarId, eventData, primaryEvent = null) => {
  const tasks = eventData.responsePackage?.calendarTasks || [];
  if (!tasks.length || !eventData.caseId) {
    return [];
  }

  const calendar = google.calendar({ version: 'v3', auth });
  const results = [];

  for (const task of tasks) {
    if (!normalizeDate(task.date) || !task.role) {
      continue;
    }

    const existing = await findRelatedCaseEvent(auth, calendarId, eventData.caseId, task.role);
    const { start, end } = toEventTimeRange(task.date, null);
    const requestBody = {
      ...(existing || {}),
      summary: task.title || `[${eventData.caseId}] ${task.action || 'CaseSync task'}`,
      description: buildRelatedDescription(eventData.caseId, task, eventData, primaryEvent),
      start,
      end,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 9 * 60 },
          { method: 'popup', minutes: 60 },
        ],
      },
      extendedProperties: {
        ...(existing?.extendedProperties || {}),
        private: {
          ...(existing?.extendedProperties?.private || {}),
          casesyncRelated: 'true',
          caseId: eventData.caseId,
          caseEventRole: task.role,
          primaryEventId: primaryEvent?.id || existing?.extendedProperties?.private?.primaryEventId || '',
          triggerName: eventData.triggerName || eventData.sourceName || '',
          status: eventData.status || 'active',
          lastUpdated: new Date().toISOString(),
        },
      },
    };

    const response = existing?.id
      ? await calendar.events.update({
        calendarId,
        eventId: existing.id,
        requestBody,
      })
      : await calendar.events.insert({
        calendarId,
        requestBody,
      });

    results.push(response.data);
  }

  return results;
};

export const listCaseEvents = async (auth, calendarId) => {
  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.events.list({
    calendarId,
    privateExtendedProperty: 'casesync=true',
    singleEvents: true,
    maxResults: 250,
    orderBy: 'startTime',
  });

  return data.items || [];
};

export const deleteCaseEvent = async (auth, calendarId, eventId) => {
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.delete({
    calendarId,
    eventId,
  });
  return true;
};

export const patchCaseStatus = async (auth, calendarId, eventId, status) => {
  const calendar = google.calendar({ version: 'v3', auth });
  const existing = await calendar.events.get({ calendarId, eventId });
  const next = existing.data;
  next.extendedProperties = {
    ...(next.extendedProperties || {}),
    private: {
      ...(next.extendedProperties?.private || {}),
      status: status || 'active',
      lastUpdated: new Date().toISOString(),
    },
  };

  const response = await calendar.events.update({
    calendarId,
    eventId,
    requestBody: next,
  });

  return response.data;
};

export const parseCaseIdFromEvent = (event) => event?.extendedProperties?.private?.caseId || '';

export const getCaseEventsByIds = async (auth, calendarId, caseIds = []) => {
  const events = await listCaseEvents(auth, calendarId);
  const allow = new Set(caseIds);
  return events.filter((event) => allow.has(parseCaseIdFromEvent(event)));
};

export const listCalendars = async (auth) => {
  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.calendarList.list({
    maxResults: 250,
    minAccessRole: 'writer',
  });

  return (data.items || []).map((item) => ({
    id: item.id,
    summary: item.summary || item.id,
    description: item.description || '',
    primary: Boolean(item.primary),
  }));
};

export const ensureTokenRefreshed = async (auth) => {
  if (!auth?.credentials) {
    return;
  }

  if (typeof auth.getAccessToken === 'function') {
    await auth.getAccessToken();
  }
};
