import {
  getTriggers,
  getAllAccountsRaw,
  addScanLog,
  updateScanLog,
  setScanState,
  getScanState,
  isProcessedEmail,
  markEmailProcessed,
  upsertAccount,
  upsertCaseRecord,
  upsertCaseEmailRecord,
  getCaseEmailByMessageId,
  getCaseRecordsFromDb,
  updateCaseRecordStatus,
  deleteCaseRecord,
} from './db.js';
import { getAuthClient, fetchTriggerEmails, fetchCaseNumberEmails } from './gmail.js';
import { parseEmail } from './parser.js';
import {
  findEventByCaseId,
  createCaseEvent,
  updateCaseEvent,
  upsertRelatedCaseEvents,
  listCaseEvents,
  deleteCaseEvent,
  patchCaseStatus,
  extractDeadlinesFromDescription,
} from './calendar.js';

const defaultCalendarId = process.env.SCAN_CALENDAR_ID || 'primary';
const scanMaxEmails = Number(process.env.SCAN_MAX_EMAILS || 1000);
const caseFolderScanMaxEmails = Number(process.env.CASE_FOLDER_SCAN_MAX_EMAILS || 100);

const runningState = {
  running: false,
};

export const getNextScheduledRun = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
};

const normalizeDate = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : normalized;
};

const parseDate = (value) => {
  const date = normalizeDate(value);
  if (!date) {
    return null;
  }
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const daysUntil = (value) => {
  const parsed = parseDate(value);
  if (!parsed) {
    return null;
  }
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((parsed.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const addDaysIso = (isoDate, days) => {
  const date = parseDate(isoDate);
  if (!date) {
    return '';
  }
  return addDays(date, days).toISOString().slice(0, 10);
};

const responseDeadlineDays = (method) => {
  if (!method) {
    return 32;
  }

  const key = String(method).toLowerCase().trim();
  if (key === 'personal') {
    return 30;
  }
  if (key === 'electronic') {
    return 32;
  }
  if (key === 'mail') {
    return 35;
  }
  return 32;
};

const estimateLabel = (value, fallback) => {
  if (!value) {
    return fallback;
  }
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(num)));
};

const safeCaseId = (value) => (typeof value === 'string' ? value.trim() : '');

const isValidCaseId = (value) => {
  const candidate = safeCaseId(value);
  if (candidate.length < 5) {
    return false;
  }
  if (!/[0-9]/.test(candidate)) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(candidate);
};

const toStatusString = (value) => (value === 'closed' || value === 'pending' || value === 'active' ? value : 'active');

const firstDeadline = (deadlines = []) => {
  return (deadlines || [])
    .filter((item) => normalizeDate(item?.date))
    .slice()
    .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))[0] || null;
};

const buildScanNotification = (type, payload, event) => {
  const deadline = firstDeadline(payload.deadlines);
  if (!deadline) {
    return null;
  }

  return {
    type,
    caseId: payload.caseId,
    caseTitle: payload.caseTitle || payload.caseId,
    action: deadline.action || 'Review case deadline',
    deadline: deadline.date,
    daysUntil: daysUntil(deadline.date),
    calendarEventUrl: event?.htmlLink || '',
    createdAt: new Date().toISOString(),
  };
};

const buildResponseDeadline = (proofServiceDate, proofServiceMethod) => {
  const anchor = parseDate(proofServiceDate);
  if (!anchor) {
    return null;
  }

  const deadlineDate = addDays(anchor, responseDeadlineDays(proofServiceMethod));
  const iso = deadlineDate.toISOString().slice(0, 10);
  if (!normalizeDate(iso)) {
    return null;
  }

  return {
    date: iso,
    time: null,
    action: `Response due: proof deadline (+${responseDeadlineDays(proofServiceMethod)} days)`,
    priority: 'high',
  };
};

const normalizeDiscoverySets = (sets = []) => {
  const cleaned = (Array.isArray(sets) ? sets : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return [...new Set(cleaned.length ? cleaned : ['Discovery responses'])];
};

const buildSkeletonDocuments = (discoverySets) => {
  return discoverySets.map((setName) => ({
    title: `${setName} response skeleton`,
    generalObjections: [
      'Objection to the extent the request seeks privileged attorney-client communications or attorney work product.',
      'Objection to the extent the request is overbroad, unduly burdensome, vague, ambiguous, or not proportional to the needs of the case.',
      'Objection to the extent the request seeks information outside the responding party custody, possession, or control.',
      'Subject to and without waiving these objections, Responding Party will respond after client review.',
    ],
    individualResponsePlaceholder: 'Response to No. ___: [Insert client facts, responsive documents, and any specific objections.]',
    verification: 'I declare under penalty of perjury under the laws of the State of California that the foregoing discovery responses are true and correct.',
  }));
};

const buildClientPrep = (discoverySets) => ({
  questions: [
    `Confirm who has knowledge needed to answer ${discoverySets.join(', ')}.`,
    'Identify any facts that support objections, limitations, or inability to respond fully.',
    'Confirm whether any documents were already produced, withheld, lost, or never existed.',
    'Confirm whether any response needs amendment, supplementation, or attorney review before service.',
  ],
  documents: [
    'All documents requested by the discovery sets, organized by request number where possible.',
    'Emails, texts, photos, contracts, invoices, medical/employment records, and prior production materials relevant to the requests.',
    'Names and contact information for witnesses or custodians with responsive information.',
    'Any prior discovery responses, pleadings, incident reports, or calendars that help verify dates and facts.',
  ],
  explanation: [
    'Client verification is required because written discovery responses are factual statements made by the responding party.',
    'The client signs the verification under penalty of perjury, so answers must be reviewed carefully for accuracy and completeness.',
    'Attorney objections can be signed by counsel, but verified factual responses require the client signature.',
  ],
});

const buildResponsePackage = ({
  proofServiceDate,
  proofServiceMethod,
  discoverySets,
  caseId,
  caseTitle,
}) => {
  const responseDeadline = buildResponseDeadline(proofServiceDate, proofServiceMethod);
  if (!responseDeadline) {
    return null;
  }

  const sets = normalizeDiscoverySets(discoverySets);
  const setLabel = sets.join(', ');
  const caseLabel = caseTitle || caseId || 'CaseSync';
  const clientCallDate = addDaysIso(proofServiceDate, 7);
  const twoWeekDate = addDaysIso(responseDeadline.date, -14);
  const oneWeekDate = addDaysIso(responseDeadline.date, -7);
  const calendarTasks = [
    {
      role: 'response-deadline',
      date: responseDeadline.date,
      title: `${caseLabel} - Last day for P to serve responses to ${setLabel}`,
      action: `Serve verified written responses to ${setLabel}.`,
      priority: 'high',
    },
    {
      role: 'two-week-tickler',
      date: twoWeekDate,
      title: `${caseLabel} - 2-week tickler - P's responses to ${setLabel}`,
      action: `Two-week tickler for discovery responses to ${setLabel}.`,
      priority: 'medium',
    },
    {
      role: 'one-week-tickler',
      date: oneWeekDate,
      title: `${caseLabel} - 1-week tickler - P's responses to ${setLabel}`,
      action: `One-week tickler for discovery responses to ${setLabel}.`,
      priority: 'high',
    },
    {
      role: 'client-call',
      date: clientCallDate,
      title: `${caseLabel} - Schedule client call re discovery responses & verifications`,
      action: 'Schedule client call about discovery responses, documents, and verification signature.',
      priority: 'medium',
    },
  ].filter((item) => normalizeDate(item.date));

  return {
    proofServiceDate,
    proofServiceMethod: proofServiceMethod || 'electronic',
    responseDeadlineDate: responseDeadline.date,
    responseDeadline,
    responseDeadlineDays: responseDeadlineDays(proofServiceMethod),
    discoverySets: sets,
    calendarTasks,
    skeletonDocuments: buildSkeletonDocuments(sets),
    clientPrep: buildClientPrep(sets),
  };
};

const storeCaseEmail = async ({
  email,
  account,
  trigger,
  caseId,
  parsed = {},
  caseConfidence = null,
  classification = 'matched',
  needsReview = false,
  sourceReason = '',
}) => {
  if (!caseId) {
    return null;
  }

  return upsertCaseEmailRecord({
    messageId: email.id,
    threadId: email.threadId,
    caseId,
    accountEmail: account.email,
    fromEmail: email.from,
    subject: email.subject,
    snippet: email.snippet,
    bodyPreview: email.body || email.snippet,
    receivedAt: email.date,
    triggerId: trigger.id,
    triggerName: trigger.name,
    caseConfidence,
    classification,
    needsReview,
    sourceReason,
    raw: {
      subject: email.subject,
      from: email.from,
      date: email.date,
      snippet: email.snippet,
      parsedSummary: parsed.summary || '',
      proofServiceDate: parsed.proofServiceDate || '',
      proofServiceMethod: parsed.proofServiceMethod || '',
      discoverySets: parsed.discoverySets || [],
      hasActionableDeadline: Boolean(parsed.hasActionableDeadline),
    },
  });
};

const shouldTreatAsEstimated = (caseId, caseConfidence, parsedEstimated) => {
  if (parsedEstimated === false) {
    return false;
  }
  if (parsedEstimated === true) {
    return true;
  }
  if (!caseId) {
    return true;
  }
  if (!Number.isFinite(caseId ? caseConfidence : 0)) {
    return true;
  }

  return caseConfidence < 80;
};

export const getScanStatus = async () => {
  return getScanState();
};

export const runAutoScan = async (triggerSource = 'auto') => {
  if (runningState.running) {
    return {
      skipped: true,
      reason: 'Scan already in progress',
    };
  }

  runningState.running = true;
  await setScanState({
    isRunning: true,
    nextRun: null,
    lastRun: new Date().toISOString(),
  });

  const log = await addScanLog({
    trigger: triggerSource,
    emailsScanned: 0,
    casesCreated: 0,
    casesUpdated: 0,
    notifications: [],
    errors: [],
  });

  const summary = {
    skipped: false,
    emailsScanned: 0,
    casesCreated: 0,
    casesUpdated: 0,
    notifications: [],
    errors: [],
  };

  try {
    const triggers = await getTriggers();
    const enabledTriggers = triggers.filter((trigger) => trigger.enabled !== false);
    const accounts = await getAllAccountsRaw();
    const knownCaseFolders = (await getCaseRecordsFromDb()).filter((item) => isValidCaseId(item.caseId));

    for (const account of accounts) {
      if (!account?.tokens) {
        continue;
      }

      const auth = getAuthClient(account.tokens, {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
      });

      for (const trigger of enabledTriggers) {
        const calendarId = trigger.calendarId || defaultCalendarId;
        const emails = await fetchTriggerEmails(auth, trigger, scanMaxEmails);

        for (const email of emails) {
          summary.emailsScanned += 1;

          const alreadyProcessed = await isProcessedEmail(email.id);
          const alreadySavedToCase = alreadyProcessed ? await getCaseEmailByMessageId(email.id) : null;
          if (alreadyProcessed && alreadySavedToCase) {
            continue;
          }

          try {
            const parsed = await parseEmail({
              subject: email.subject,
              body: email.body,
              from: email.from,
              date: email.date,
              caseIdPatterns: trigger.caseIdPatterns || [],
            });

            const parsedCaseId = safeCaseId(parsed.caseId);
            const caseId = isValidCaseId(parsedCaseId) ? parsedCaseId : '';
            const deadlines = Array.isArray(parsed.deadlines) ? [...parsed.deadlines] : [];
            const responsePackage = buildResponsePackage({
              proofServiceDate: parsed.proofServiceDate,
              proofServiceMethod: parsed.proofServiceMethod,
              discoverySets: parsed.discoverySets,
              caseId,
              caseTitle: parsed.caseTitle || caseId,
            });

            const proofDeadline = responsePackage?.responseDeadline || null;
            if (proofDeadline) {
              const alreadyExists = deadlines.some((item) => item.date === proofDeadline.date && item.action === proofDeadline.action);
              if (!alreadyExists) {
                deadlines.push(proofDeadline);
              }
            }

            const hasActionableDeadline = Boolean(
              caseId && deadlines.length > 0 && (parsed.hasActionableDeadline || proofDeadline !== null),
            );

            if (!hasActionableDeadline) {
              if (caseId) {
                const reviewConfidence = estimateLabel(parsed.caseConfidence, 70);
                await storeCaseEmail({
                  email,
                  account,
                  trigger,
                  caseId,
                  parsed,
                  caseConfidence: reviewConfidence,
                  classification: 'case-signal',
                  needsReview: true,
                  sourceReason: 'Case signal found, but no actionable deadline was confirmed.',
                });
              }
              await markEmailProcessed(email.id);
              continue;
            }

            const caseConfidence = estimateLabel(parsed.caseConfidence, caseId ? 70 : 50);
            const payload = {
              caseId,
              caseTitle: parsed.caseTitle || caseId,
              summary: parsed.summary || '',
              status: toStatusString(parsed.status),
              trigger,
              triggerName: trigger.name,
              deadlines,
              emailId: email.id,
              sourceEmail: email.from,
              sourceName: trigger.name,
              caseConfidence,
              estimated: shouldTreatAsEstimated(caseId, caseConfidence, parsed.estimated),
              proofServiceDate: parsed.proofServiceDate || '',
              proofServiceMethod: parsed.proofServiceMethod || '',
              discoverySets: responsePackage?.discoverySets || [],
              responseDeadlineDate: proofDeadline?.date || '',
              responsePackage,
              raw: email,
            };

            const existing = await findEventByCaseId(auth, calendarId, caseId);
            if (existing?.id) {
              const updated = await updateCaseEvent(auth, calendarId, existing.id, payload);
              await upsertRelatedCaseEvents(auth, calendarId, payload, updated);
              await upsertCaseRecord({
                ...payload,
                id: updated.id,
                htmlLink: updated.htmlLink || '',
                description: updated.description || '',
                lastUpdated: updated.extendedProperties?.private?.lastUpdated || updated.updated || new Date().toISOString(),
                sourceAccount: account.email,
                sourceCalendarId: calendarId,
                sourceEventSummary: updated.summary || '',
                start: updated.start || null,
                end: updated.end || null,
              });
              summary.casesUpdated += 1;
              const notification = buildScanNotification('updated_case', payload, updated);
              if (notification) {
                summary.notifications.push(notification);
              }
            } else {
              const created = await createCaseEvent(auth, calendarId, payload);
              await upsertRelatedCaseEvents(auth, calendarId, payload, created);
              await upsertCaseRecord({
                ...payload,
                id: created.id,
                htmlLink: created.htmlLink || '',
                description: created.description || '',
                lastUpdated: created.extendedProperties?.private?.lastUpdated || created.updated || new Date().toISOString(),
                sourceAccount: account.email,
                sourceCalendarId: calendarId,
                sourceEventSummary: created.summary || '',
                start: created.start || null,
                end: created.end || null,
              });
              summary.casesCreated += 1;
              const notification = buildScanNotification('new_case', payload, created);
              if (notification) {
                summary.notifications.push(notification);
              }
            }

            await storeCaseEmail({
              email,
              account,
              trigger,
              caseId,
              parsed,
              caseConfidence,
              classification: 'deadline-package',
              needsReview: caseConfidence < 80 || Boolean(payload.estimated),
              sourceReason: 'Trigger matched and CaseSync created or updated a response deadline package.',
            });
            await markEmailProcessed(email.id);
          } catch (error) {
            const msg = `${trigger.name || trigger.id}: ${error.message || 'scan error'}`;
            summary.errors.push(msg);
          }
        }
      }

      for (const folder of knownCaseFolders) {
        const emails = await fetchCaseNumberEmails(auth, folder.caseId, caseFolderScanMaxEmails);
        for (const email of emails) {
          const alreadySavedToCase = await getCaseEmailByMessageId(email.id);
          if (alreadySavedToCase?.caseId === folder.caseId) {
            continue;
          }

          summary.emailsScanned += 1;

          try {
            const parsed = await parseEmail({
              subject: email.subject,
              body: email.body,
              from: email.from,
              date: email.date,
              caseIdPatterns: [],
            });
            const parsedCaseId = safeCaseId(parsed.caseId);
            const matchedCaseId = parsedCaseId === folder.caseId || `${email.subject}\n${email.body}`.includes(folder.caseId)
              ? folder.caseId
              : '';

            if (!matchedCaseId) {
              continue;
            }

            const caseConfidence = estimateLabel(parsed.caseConfidence, parsed.caseId ? 86 : 72);
            const deadlines = Array.isArray(parsed.deadlines) ? [...parsed.deadlines] : [];
            const responsePackage = buildResponsePackage({
              proofServiceDate: parsed.proofServiceDate,
              proofServiceMethod: parsed.proofServiceMethod,
              discoverySets: parsed.discoverySets,
              caseId: matchedCaseId,
              caseTitle: folder.caseTitle || matchedCaseId,
            });
            const proofDeadline = responsePackage?.responseDeadline || null;
            if (proofDeadline && !deadlines.some((item) => item.date === proofDeadline.date && item.action === proofDeadline.action)) {
              deadlines.push(proofDeadline);
            }

            await storeCaseEmail({
              email,
              account,
              trigger: { id: 'case-folder-scan', name: 'Case folder search' },
              caseId: matchedCaseId,
              parsed,
              caseConfidence,
              classification: proofDeadline ? 'deadline-package' : 'case-folder-match',
              needsReview: !proofDeadline || caseConfidence < 80,
              sourceReason: proofDeadline
                ? 'Matched by case folder number and detected a response deadline package.'
                : 'Matched by case folder number. Review to confirm relevance.',
            });

            if (!proofDeadline) {
              continue;
            }

            await upsertCaseRecord({
              ...folder,
              caseId: matchedCaseId,
              caseTitle: folder.caseTitle || parsed.caseTitle || matchedCaseId,
              caseColor: folder.caseColor || '',
              triggerName: folder.triggerName || 'Case folder search',
              summary: parsed.summary || folder.summary || '',
              deadlines,
              caseConfidence,
              isEstimated: shouldTreatAsEstimated(matchedCaseId, caseConfidence, parsed.estimated),
              proofServiceDate: parsed.proofServiceDate || folder.proofServiceDate || '',
              proofServiceMethod: parsed.proofServiceMethod || folder.proofServiceMethod || '',
              discoverySets: responsePackage?.discoverySets || folder.discoverySets || [],
              responseDeadlineDate: proofDeadline.date,
              responsePackage,
              sourceAccount: account.email,
              sourceCalendarId: folder.sourceCalendarId || defaultCalendarId,
              sourceEventSummary: folder.sourceEventSummary || '',
              lastUpdated: new Date().toISOString(),
            });
            summary.casesUpdated += 1;
          } catch (error) {
            summary.errors.push(`${folder.caseId}: ${error.message || 'case folder scan error'}`);
          }
        }
      }

      await upsertAccount({
        ...account,
        tokens: {
          ...(account.tokens || {}),
          ...(auth.credentials || {}),
        },
      });
    }

    const finishedAt = new Date().toISOString();
    await updateScanLog(log.id, {
      ...summary,
      finishedAt,
    });
    await setScanState({
      isRunning: false,
      lastRun: finishedAt,
      nextRun: getNextScheduledRun(),
    });

    return summary;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await updateScanLog(log.id, {
      finishedAt,
      errors: [error?.message || 'Unknown scan error'],
    });
    await setScanState({
      isRunning: false,
      lastRun: finishedAt,
      nextRun: getNextScheduledRun(),
    });
    throw error;
  } finally {
    runningState.running = false;
  }
};

const toDeadlineUi = (item) => {
  const nextDeadline = (item.deadlines || [])
    .slice()
    .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))[0] || null;

  return {
    ...item,
    deadlines: item.deadlines,
    nextDeadline,
  };
};

const responseDeadlineFromService = (proofServiceDate, proofServiceMethod) => {
  const derived = buildResponseDeadline(proofServiceDate, proofServiceMethod);
  return derived?.date || '';
};

const parseConfidence = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(num)));
};

export const importCalendarCasesToDb = async () => {
  const triggers = await getTriggers();
  const calendarIds = [...new Set((triggers || []).map((trigger) => trigger.calendarId || defaultCalendarId))];
  const accounts = await getAllAccountsRaw();
  let imported = 0;

  for (const account of accounts) {
    if (!account?.tokens) {
      continue;
    }

    try {
      const auth = getAuthClient(account.tokens, {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
      });

      for (const calendarId of calendarIds) {
        try {
          const events = await listCaseEvents(auth, calendarId);
          for (const event of events) {
            const caseId = event.extendedProperties?.private?.caseId || '';
            if (!isValidCaseId(caseId)) {
              continue;
            }

            const deadlines = extractDeadlinesFromDescription(event.description || '');
            const proofServiceDate = normalizeDate(event.extendedProperties?.private?.proofServiceDate) || '';
            const proofServiceMethod = event.extendedProperties?.private?.proofServiceMethod || '';
            const responseDeadlineDate = normalizeDate(event.extendedProperties?.private?.responseDeadlineDate)
              || responseDeadlineFromService(proofServiceDate, proofServiceMethod);

            await upsertCaseRecord({
              id: event.id,
              caseId,
              caseTitle: (event.summary || '').replace(/^\[[^\]]+\]\s*/, ''),
              status: event.extendedProperties?.private?.status || 'active',
              triggerId: event.extendedProperties?.private?.triggerId || null,
              triggerName: event.extendedProperties?.private?.triggerName || null,
              htmlLink: event.htmlLink || '',
              summary: event.summary || '',
              description: event.description || '',
              lastUpdated: event.extendedProperties?.private?.lastUpdated || event.updated || new Date().toISOString(),
              caseConfidence: parseConfidence(event.extendedProperties?.private?.caseConfidence),
              isEstimated: (event.extendedProperties?.private?.estimated || 'false') === 'true',
              deadlines,
              sourceCalendarId: calendarId,
              sourceAccount: account.email,
              sourceEventSummary: event.summary || '',
              start: event.start || null,
              end: event.end || null,
              proofServiceDate,
              proofServiceMethod,
              responseDeadlineDate,
              discoverySets: (event.extendedProperties?.private?.discoverySets || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            });
            imported += 1;
          }
        } catch (error) {
          console.warn(`Skipping calendar import ${calendarId} for ${account.email}: ${error.message || 'calendar read failed'}`);
        }
      }
    } catch (error) {
      console.warn(`Skipping account import ${account.email}: ${error.message || 'account read failed'}`);
    }
  }

  return { imported };
};

export const createManualCase = async ({
  accountEmail = '',
  calendarId = defaultCalendarId,
  caseId = '',
  caseTitle = '',
  proofServiceDate = '',
  proofServiceMethod = 'electronic',
  discoverySets = [],
}) => {
  const normalizedCaseId = safeCaseId(caseId);
  if (!isValidCaseId(normalizedCaseId)) {
    throw new Error('A valid case ID is required');
  }

  const responsePackage = buildResponsePackage({
    proofServiceDate,
    proofServiceMethod,
    discoverySets,
    caseId: normalizedCaseId,
    caseTitle: caseTitle || normalizedCaseId,
  });

  if (!responsePackage?.responseDeadline) {
    throw new Error('A valid Proof of Service date is required');
  }

  const accounts = await getAllAccountsRaw();
  const account = accountEmail
    ? accounts.find((entry) => entry.email === accountEmail)
    : accounts[0];

  if (!account?.tokens) {
    throw new Error('Connected Google account not found');
  }

  const auth = getAuthClient(account.tokens, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });

  const targetCalendarId = calendarId || defaultCalendarId;
  const deadlines = [responsePackage.responseDeadline];
  const payload = {
    caseId: normalizedCaseId,
    caseTitle: caseTitle || normalizedCaseId,
    summary: 'Manually created deadline package.',
    status: 'active',
    trigger: null,
    triggerName: 'Manual calendar entry',
    deadlines,
    emailId: '',
    sourceEmail: account.email,
    sourceName: 'Manual calendar entry',
    caseConfidence: 100,
    estimated: false,
    proofServiceDate,
    proofServiceMethod: responsePackage.proofServiceMethod,
    discoverySets: responsePackage.discoverySets,
    responseDeadlineDate: responsePackage.responseDeadlineDate,
    responsePackage,
    raw: null,
  };

  const existing = await findEventByCaseId(auth, targetCalendarId, normalizedCaseId);
  const event = existing?.id
    ? await updateCaseEvent(auth, targetCalendarId, existing.id, payload)
    : await createCaseEvent(auth, targetCalendarId, payload);

  await upsertRelatedCaseEvents(auth, targetCalendarId, payload, event);
  const record = await upsertCaseRecord({
    ...payload,
    id: event.id,
    htmlLink: event.htmlLink || '',
    description: event.description || '',
    lastUpdated: event.extendedProperties?.private?.lastUpdated || event.updated || new Date().toISOString(),
    sourceAccount: account.email,
    sourceCalendarId: targetCalendarId,
    sourceEventSummary: event.summary || '',
    start: event.start || null,
    end: event.end || null,
  });

  return { case: toDeadlineUi(record), calendarEventUrl: event.htmlLink || '' };
};

export const createCaseFolder = async ({
  caseId = '',
  caseTitle = '',
  caseColor = '',
}) => {
  const normalizedCaseId = safeCaseId(caseId);
  if (!isValidCaseId(normalizedCaseId)) {
    throw new Error('A valid case number is required');
  }

  const stored = await getCaseRecordsFromDb();
  const existing = stored.find((item) => item.caseId === normalizedCaseId);
  const now = new Date().toISOString();
  const record = await upsertCaseRecord({
    ...(existing || {}),
    id: existing?.id || normalizedCaseId,
    caseId: normalizedCaseId,
    caseTitle: caseTitle || existing?.caseTitle || normalizedCaseId,
    caseColor: caseColor || existing?.caseColor || '',
    status: existing?.status || 'active',
    triggerName: 'Manual case folder',
    summary: existing?.summary || 'Manual case folder. Related emails will appear here after scans.',
    description: existing?.description || '',
    lastUpdated: now,
    caseConfidence: existing?.caseConfidence ?? 100,
    isEstimated: existing?.isEstimated ?? false,
    deadlines: existing?.deadlines || [],
    sourceCalendarId: existing?.sourceCalendarId || 'CaseSync',
    sourceAccount: existing?.sourceAccount || '',
    sourceEventSummary: existing?.sourceEventSummary || '',
    start: existing?.start || null,
    end: existing?.end || null,
    proofServiceDate: existing?.proofServiceDate || '',
    proofServiceMethod: existing?.proofServiceMethod || '',
    responseDeadlineDate: existing?.responseDeadlineDate || '',
    discoverySets: existing?.discoverySets || [],
  });

  return { case: toDeadlineUi(record) };
};

export const getCaseRecords = async (_targetAccountEmail = null) => {
  const stored = await getCaseRecordsFromDb();
  return stored.map(toDeadlineUi);
};

export const updateCaseById = async (caseId, status) => {
  const target = await updateCaseRecordStatus(caseId, status);
  if (!target) {
    return null;
  }
  const accounts = await getAllAccountsRaw();
  const account = accounts.find((entry) => entry.email === target.sourceAccount);
  if (!account?.tokens) {
    throw new Error('Account not found');
  }

  const auth = getAuthClient(account.tokens, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });

  await patchCaseStatus(auth, target.sourceCalendarId, target.id, status).catch(() => undefined);
  return { success: true };
};

export const deleteCaseById = async (caseId) => {
  const cases = await getCaseRecords();
  const targets = cases.filter((item) => item.caseId === caseId);
  if (targets.length === 0) {
    const deletedOnlyFromDb = await deleteCaseRecord(caseId);
    return deletedOnlyFromDb ? { success: true } : null;
  }

  const target = targets[0];
  const accounts = await getAllAccountsRaw();
  const account = accounts.find((entry) => entry.email === target.sourceAccount);
  if (!account?.tokens) {
    const deletedOnlyFromDb = await deleteCaseRecord(caseId);
    return deletedOnlyFromDb ? { success: true } : null;
  }

  const auth = getAuthClient(account.tokens, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });

  await deleteCaseEvent(auth, target.sourceCalendarId, target.id).catch(() => undefined);
  await deleteCaseRecord(caseId);
  return { success: true };
};
