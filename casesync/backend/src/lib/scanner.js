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
  getCaseEmailRecords,
  getCaseRecordsFromDb,
  updateCaseRecordStatus,
  deleteCaseRecord,
} from './db.js';
import { getAuthClient, fetchTriggerEmails, fetchCaseFolderEmails } from './gmail.js';
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
const scanStaleMs = Number(process.env.SCAN_STALE_MS || 15 * 60 * 1000);
const ALLOW_AUTOMATIC_CALENDAR_WRITES = process.env.ALLOW_AUTOMATIC_CALENDAR_WRITES === 'true';

const runningState = {
  running: false,
  startedAt: 0,
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
  const d = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  const [year, month, day] = normalized.split('-').map(Number);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    return null;
  }
  return normalized;
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

const normalizeServiceMethodForDeadline = (method) => {
  const key = String(method || '').toLowerCase().trim();
  if (key === 'personal' || key === 'electronic' || key === 'mail') {
    return key;
  }
  return 'electronic';
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

const folderIdFromCaseTitle = (value = '') => {
  const slug = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug ? `CASE-${slug}` : '';
};

const isValidCaseFolderId = (value) => (
  isValidCaseId(value) || /^CASE-[A-Z0-9][A-Z0-9-]{3,}$/.test(String(value || '').trim())
);

const normalizeTextMatch = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const caseFolderSearchTerms = (folder = {}) => {
  const terms = [];
  const addTerm = (value = '') => {
    const clean = String(value || '')
      .replace(/\bet\s+al\.?\b/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+,/g, ',')
      .trim()
      .replace(/[.,;:]+$/g, '');

    if (clean.length >= 3 && !terms.includes(clean)) {
      terms.push(clean);
    }
  };
  const titleAliasStopwords = new Set([
    'case',
    'company',
    'corporation',
    'inc',
    'incorporated',
    'corp',
    'llc',
    'ltd',
    'limited',
    'building',
    'exchange',
    'coffee',
    'hardware',
    'transport',
    'plaintiff',
    'defendant',
    'estate',
    'the',
    'and',
    'for',
    'with',
  ]);
  const addTitleAliases = (value = '') => {
    const cleanTitle = String(value || '')
      .replace(/[()]/g, ' ')
      .replace(/\bet\s+al\.?\b/gi, ' ')
      .replace(/\b(case|incorporated|corporation|company)\b/gi, ' ')
      .replace(/[^\w\s.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = cleanTitle
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !titleAliasStopwords.has(word.toLowerCase()));

    for (let index = 0; index < Math.min(words.length - 1, 4); index += 1) {
      addTerm(`${words[index]} ${words[index + 1]}`);
    }
  };
  const caseId = safeCaseId(folder.caseId);
  const title = String(folder.caseTitle || '').trim();

  if (caseId && !caseId.startsWith('CASE-')) {
    addTerm(caseId);
    const spacedCaseId = caseId.replace(/^([A-Z0-9]*?[A-Z]{2,})(\d{3,})$/i, '$1 $2');
    const dashedCaseId = caseId.replace(/^([A-Z0-9]*?[A-Z]{2,})(\d{3,})$/i, '$1-$2');
    addTerm(spacedCaseId);
    addTerm(dashedCaseId);
  }

  if (title && title !== caseId) {
    addTerm(title);
    if (/\bbuilding\b/i.test(title) && !/\bmaterials?\b/i.test(title)) {
      addTerm(`${title} Materials`);
    }
    addTitleAliases(title);
    const compactTitle = title
      .replace(/\b(vs?\.?|versus)\b/gi, ' v ')
      .replace(/\b(incorporated)\b/gi, 'inc')
      .replace(/\bet\s+al\.?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    addTerm(compactTitle);

    for (const part of title.split(/\b(?:v\.?|vs\.?|versus|,)\b/i)) {
      const clean = part.trim().replace(/[.,;:]+$/g, '');
      if (clean.length >= 5) {
        addTerm(clean);
        const words = clean.split(/\s+/).filter(Boolean);
        if (words.length >= 2) {
          addTerm(words.slice(0, 2).join(' '));
        }
        if (words.length >= 3) {
          addTerm(words.slice(0, 3).join(' '));
        }
      }
    }
  }

  return [...new Set(terms.map((item) => String(item || '').trim()).filter((item) => item.length >= 3))].slice(0, 18);
};

const hasExtractedAttachmentText = (email = {}) => {
  if (!Array.isArray(email.attachments)) return false;
  return email.attachments.some((attachment) => attachment?.extracted || Number(attachment?.textLength || 0) > 0);
};

const calendarCandidateDeadlines = (parsed = {}) => {
  if (!Array.isArray(parsed.deadlines)) return [];
  return parsed.deadlines
    .map((deadline) => ({
      ...deadline,
      date: normalizeDate(deadline.date),
    }))
    .filter((deadline) => deadline.date);
};

const mergeCaseDeadlines = (...deadlineGroups) => {
  const seen = new Set();
  const merged = [];

  for (const group of deadlineGroups) {
    for (const deadline of Array.isArray(group) ? group : []) {
      const date = normalizeDate(deadline?.date);
      if (!date) continue;
      const action = String(deadline.action || deadline.title || 'Calendar candidate').trim();
      const key = `${date}|${action.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...deadline,
        date,
        action,
      });
    }
  }

  return merged;
};

const scanCaseFilterKeys = (value = '') => {
  const raw = String(value || '').trim();
  const keys = new Set();
  if (!raw) return keys;

  keys.add(raw.toLowerCase());
  const normalizedCase = safeCaseId(raw).replace(/[^a-z0-9]/gi, '');
  if (normalizedCase) keys.add(normalizedCase.toLowerCase());
  const normalizedText = normalizeTextMatch(raw);
  if (normalizedText) keys.add(normalizedText);

  return keys;
};

const normalizeScanCaseFilters = (value) => {
  const values = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const filters = new Set();
  values.forEach((item) => {
    scanCaseFilterKeys(item).forEach((key) => filters.add(key));
  });
  return filters;
};

const caseMatchesScanFilter = (folder = {}, filters = new Set()) => {
  if (!filters.size) return true;
  const candidates = [
    folder.caseId,
    folder.caseTitle,
    folder.title,
    folder.name,
    ...caseFolderSearchTerms(folder),
  ];

  return candidates.some((candidate) => {
    for (const key of scanCaseFilterKeys(candidate)) {
      if (filters.has(key)) return true;
    }
    return false;
  });
};

const emailMatchesCaseFolder = (email = {}, folder = {}) => {
  const text = normalizeTextMatch(`${email.subject || ''}\n${email.from || ''}\n${email.snippet || ''}\n${email.body || ''}`);
  const terms = caseFolderSearchTerms(folder);

  return terms.some((term) => {
    const normalized = normalizeTextMatch(term);
    return normalized.length >= 3 && text.includes(normalized);
  });
};

const toStatusString = (value) => (value === 'closed' || value === 'pending' || value === 'active' ? value : 'active');

const firstDeadline = (deadlines = []) => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const sorted = (deadlines || [])
    .filter((item) => normalizeDate(item?.date))
    .slice()
    .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
  return sorted.find((item) => item.date >= todayIso) || sorted[sorted.length - 1] || null;
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

  const method = normalizeServiceMethodForDeadline(proofServiceMethod);
  const days = responseDeadlineDays(method);
  const deadlineDate = addDays(anchor, days);
  const iso = deadlineDate.toISOString().slice(0, 10);
  if (!normalizeDate(iso)) {
    return null;
  }

  return {
    date: iso,
    time: null,
    action: `Response due: proof deadline (+${days} days)`,
    priority: 'high',
    serviceMethod: method,
    responseDeadlineDays: days,
  };
};

const normalizeDiscoverySets = (sets = []) => {
  const cleaned = (Array.isArray(sets) ? sets : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return [...new Set(cleaned)];
};

const hasWrittenDiscoverySignal = (sets = []) => {
  return normalizeDiscoverySets(sets).some((item) => (
    /\b(e[-\s]?rogs?|g[-\s]?rogs?|rfps?|rfas?|interrogator(?:y|ies)|requests?\s+for\s+(?:production|admissions?))\b/i.test(item)
  ));
};

const isInternalStatusReportEmail = (email = {}) => {
  const subject = String(email.subject || '').trim();
  return /\b(case status list|case list|chat case update|active case data transfer|data transfer update|eod(?:\s+(?:report|update|check-?in))?|end of day|todo|to do)\b/i.test(subject);
};

const hasReliableDiscoveryDeadlineSource = (email = {}, parsed = {}) => {
  if (!parsed?.proofServiceDate || !hasWrittenDiscoverySignal(parsed.discoverySets)) {
    return false;
  }

  const subject = String(email.subject || '').trim();
  const emailText = `${subject}\n${email.snippet || ''}\n${email.body || ''}`;
  const parsedText = `${parsed.summary || ''}`;
  const text = `${emailText}\n${parsedText}`;
  const statusOnlySubject = isInternalStatusReportEmail(email);
  const writtenDiscoveryInEmail = /\b(discovery served|written discovery|form interrogator(?:y|ies)|special interrogator(?:y|ies)|interrogator(?:y|ies)|requests?\s+for\s+production|requests?\s+for\s+admissions?|rfps?|rfas?|s[-\s]?rogs?|g[-\s]?rogs?|e[-\s]?rogs?)\b/i.test(emailText);
  const courtNoticeOnly = /\b(court eservice|eservice-donotreply@lacourt|minute order|notice of case management conference|case management conference|cmc|hearing|osc declaration|clerk'?s certificate)\b/i.test(text)
    && !writtenDiscoveryInEmail;
  const legalServiceSignal = /\b(proof of service|electronic service|personal service|mail service|served|service by|discovery served|interrogator(?:y|ies)|requests?\s+for\s+production|requests?\s+for\s+admissions?|rfps?|rfas?|g[-\s]?rogs?|e[-\s]?rogs?)\b/i.test(text);

  return legalServiceSignal && writtenDiscoveryInEmail && !statusOnlySubject && !courtNoticeOnly;
};

const titleWords = (value = '') => normalizeTextMatch(value)
  .split(/\s+/)
  .map((word) => word.replace(/s$/i, ''))
  .filter((word) => word.length >= 4);

const deadlineMentionsDifferentCase = (deadline = {}, target = {}, cases = []) => {
  const actionWords = new Set(titleWords(deadline.action || deadline.title || ''));
  if (!actionWords.size) return false;

  return cases.some((item) => {
    if (!item?.caseId || item.caseId === target.caseId) return false;
    const words = titleWords(item.caseTitle || item.caseId);
    if (words.length < 2) return false;
    return words.slice(0, 4).filter((word) => actionWords.has(word)).length >= 2;
  });
};

const discoverySetsForPackage = (sets = []) => {
  const normalized = normalizeDiscoverySets(sets);
  return normalized.length ? normalized : ['Discovery responses'];
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
  const normalizedMethod = normalizeServiceMethodForDeadline(proofServiceMethod);
  const responseDeadline = buildResponseDeadline(proofServiceDate, normalizedMethod);
  if (!responseDeadline) {
    return null;
  }

  if (!hasWrittenDiscoverySignal(discoverySets)) {
    return null;
  }

  const sets = discoverySetsForPackage(discoverySets);
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
    proofServiceMethod: normalizedMethod,
    responseDeadlineDate: responseDeadline.date,
    responseDeadline,
    responseDeadlineDays: responseDeadlineDays(normalizedMethod),
    discoverySets: sets,
    calendarTasks,
    skeletonDocuments: buildSkeletonDocuments(sets),
    clientPrep: buildClientPrep(sets),
  };
};

const shouldWriteCalendarForCase = (caseRecord = {}) => (
  ALLOW_AUTOMATIC_CALENDAR_WRITES
  && caseRecord.calendarAutoEnabled === true
  && caseRecord.reviewBeforeCalendarUpdate !== true
);

const calendarHoldReason = (caseRecord = {}) => {
  if (!ALLOW_AUTOMATIC_CALENDAR_WRITES) {
    return 'Automatic Google Calendar updates are paused. CaseSync saved this for review instead.';
  }
  if (caseRecord.calendarAutoEnabled === false) {
    return 'Calendar update held because auto calendar updates are off.';
  }
  if (caseRecord.reviewBeforeCalendarUpdate === true) {
    return 'Calendar update held for user review.';
  }
  return '';
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
  if (isInternalStatusReportEmail(email)) {
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
      attachments: email.attachments || [],
      attachmentTextLength: email.attachmentText?.length || 0,
      parsedSummary: parsed.summary || '',
      proofServiceDate: parsed.proofServiceDate || '',
      proofServiceMethod: parsed.proofServiceMethod || '',
      discoverySets: parsed.discoverySets || [],
      hasActionableDeadline: Boolean(parsed.hasActionableDeadline),
      parserSource: parsed.parserSource || '',
      aiAnalysis: parsed.aiAnalysis || null,
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

const readScanLimit = (value, fallback, max) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, parsed));
};

export const runAutoScan = async (triggerSource = 'auto', options = {}) => {
  if (runningState.running) {
    const age = runningState.startedAt ? Date.now() - runningState.startedAt : 0;
    if (age < scanStaleMs) {
      return {
        skipped: true,
        reason: 'Scan already in progress',
      };
    }

    console.warn(`Resetting stale scan lock after ${Math.round(age / 1000)} seconds`);
  }

  runningState.running = true;
  runningState.startedAt = Date.now();
  const triggerEmailLimit = readScanLimit(options.maxEmails, scanMaxEmails, scanMaxEmails);
  const caseFolderEmailLimit = readScanLimit(options.caseFolderMaxEmails, caseFolderScanMaxEmails, caseFolderScanMaxEmails);
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
    const requestedCaseFilters = normalizeScanCaseFilters(options.caseIds);
    const knownCaseFolders = (await getCaseRecordsFromDb())
      .filter((item) => isValidCaseFolderId(item.caseId))
      .filter((item) => caseMatchesScanFilter(item, requestedCaseFilters));

    for (const account of accounts) {
      if (!account?.tokens) {
        continue;
      }

      const auth = getAuthClient(account.tokens, {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
      });

      if (!requestedCaseFilters.size) for (const trigger of enabledTriggers) {
        const calendarId = trigger.calendarId || defaultCalendarId;
        const emails = await fetchTriggerEmails(auth, trigger, triggerEmailLimit);

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
            let responsePackage = buildResponsePackage({
              proofServiceDate: parsed.proofServiceDate,
              proofServiceMethod: parsed.proofServiceMethod,
              discoverySets: parsed.discoverySets,
              caseId,
              caseTitle: parsed.caseTitle || caseId,
            });
            if (responsePackage && !hasReliableDiscoveryDeadlineSource(email, parsed)) {
              responsePackage = null;
            }

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
              proofServiceMethod: responsePackage?.proofServiceMethod || parsed.proofServiceMethod || '',
              discoverySets: responsePackage?.discoverySets || [],
              responseDeadlineDate: proofDeadline?.date || '',
              responsePackage,
              raw: email,
            };

            const storedCases = await getCaseRecordsFromDb();
            const storedCase = storedCases.find((item) => item.caseId === caseId);
            const canWriteCalendar = shouldWriteCalendarForCase(storedCase);
            if (!canWriteCalendar) {
              await upsertCaseRecord({
                ...(storedCase || {}),
                ...payload,
                id: storedCase?.id || caseId,
                htmlLink: storedCase?.htmlLink || '',
                description: storedCase?.description || '',
                lastUpdated: new Date().toISOString(),
                sourceAccount: account.email,
                sourceCalendarId: storedCase?.sourceCalendarId || calendarId,
                sourceEventSummary: storedCase?.sourceEventSummary || '',
                start: storedCase?.start || null,
                end: storedCase?.end || null,
                calendarAutoEnabled: storedCase?.calendarAutoEnabled,
                reviewBeforeCalendarUpdate: storedCase?.reviewBeforeCalendarUpdate,
                calendarAction: calendarHoldReason(storedCase),
              });
              await storeCaseEmail({
                email,
                account,
                trigger,
                caseId,
                parsed,
                caseConfidence,
                classification: 'review_needed',
                needsReview: true,
                sourceReason: calendarHoldReason(storedCase),
              });
              await markEmailProcessed(email.id);
              summary.casesUpdated += 1;
              continue;
            }

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
                calendarAction: 'Google Calendar updated from Gmail scan',
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
                calendarAction: 'Google Calendar event created from Gmail scan',
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
        const searchTerms = caseFolderSearchTerms(folder);
        const emails = await fetchCaseFolderEmails(auth, searchTerms, caseFolderEmailLimit);
        for (const email of emails) {
          const alreadySavedToCase = await getCaseEmailByMessageId(email.id);
          if (
            alreadySavedToCase?.caseId === 'IGNORED-UNRELATED'
            || alreadySavedToCase?.classification === 'ignored'
            || isInternalStatusReportEmail(email)
          ) {
            continue;
          }
          if (!requestedCaseFilters.size && alreadySavedToCase?.caseId === folder.caseId) {
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
            const matchedCaseId = parsedCaseId === folder.caseId
              || emailMatchesCaseFolder(email, folder)
              ? folder.caseId
              : '';

            if (!matchedCaseId) {
              continue;
            }

            const caseConfidence = estimateLabel(parsed.caseConfidence, parsed.caseId ? 86 : 72);
            const deadlines = Array.isArray(parsed.deadlines) ? [...parsed.deadlines] : [];
            let responsePackage = buildResponsePackage({
              proofServiceDate: parsed.proofServiceDate,
              proofServiceMethod: parsed.proofServiceMethod,
              discoverySets: parsed.discoverySets,
              caseId: matchedCaseId,
              caseTitle: folder.caseTitle || matchedCaseId,
            });
            if (responsePackage && !hasReliableDiscoveryDeadlineSource(email, parsed)) {
              responsePackage = null;
            }
            const proofDeadline = responsePackage?.responseDeadline || null;
            if (proofDeadline && !deadlines.some((item) => item.date === proofDeadline.date && item.action === proofDeadline.action)) {
              deadlines.push(proofDeadline);
            }
            const extractedAttachmentText = hasExtractedAttachmentText(email);
            const candidateDeadlines = calendarCandidateDeadlines(parsed);

            await storeCaseEmail({
              email,
              account,
              trigger: { id: 'case-folder-scan', name: 'Case folder search' },
              caseId: matchedCaseId,
              parsed,
              caseConfidence,
              classification: proofDeadline ? 'deadline-package' : extractedAttachmentText ? 'attachment-ai-review' : 'case-folder-match',
              needsReview: !proofDeadline || caseConfidence < 80,
              sourceReason: proofDeadline
                ? 'Matched by case folder number/name and detected a response deadline package.'
                : extractedAttachmentText
                  ? 'Matched by case folder/name and AI reviewed extracted attachment text for schedule candidates.'
                  : 'Matched by case folder number/name. Review to confirm relevance.',
            });

            if (!proofDeadline) {
              if (extractedAttachmentText && candidateDeadlines.length) {
                await upsertCaseRecord({
                  ...folder,
                  caseId: matchedCaseId,
                  caseTitle: folder.caseTitle || parsed.caseTitle || matchedCaseId,
                  caseColor: folder.caseColor || '',
                  triggerName: folder.triggerName || 'Case folder search',
                  summary: parsed.summary || folder.summary || 'AI reviewed an attachment and found schedule candidates for review.',
                  deadlines: mergeCaseDeadlines(folder.deadlines || [], candidateDeadlines),
                  caseConfidence,
                  isEstimated: shouldTreatAsEstimated(matchedCaseId, caseConfidence, parsed.estimated),
                  proofServiceDate: folder.proofServiceDate || '',
                  proofServiceMethod: folder.proofServiceMethod || '',
                  discoverySets: normalizeDiscoverySets(folder.discoverySets || []),
                  responseDeadlineDate: folder.responseDeadlineDate || '',
                  responsePackage: folder.responsePackage || null,
                  sourceAccount: account.email,
                  sourceCalendarId: folder.sourceCalendarId || defaultCalendarId,
                  sourceEventSummary: folder.sourceEventSummary || '',
                  lastUpdated: new Date().toISOString(),
                  calendarAutoEnabled: folder.calendarAutoEnabled,
                  reviewBeforeCalendarUpdate: folder.reviewBeforeCalendarUpdate,
                  calendarAction: 'AI found schedule candidates from an attachment. Review before adding to Google Calendar.',
                });
                summary.casesUpdated += 1;
              }
              continue;
            }

            if (!shouldWriteCalendarForCase(folder)) {
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
                proofServiceMethod: responsePackage?.proofServiceMethod || parsed.proofServiceMethod || folder.proofServiceMethod || '',
                discoverySets: responsePackage?.discoverySets || folder.discoverySets || [],
                responseDeadlineDate: proofDeadline.date,
                responsePackage,
                sourceAccount: account.email,
                sourceCalendarId: folder.sourceCalendarId || defaultCalendarId,
                sourceEventSummary: folder.sourceEventSummary || '',
                lastUpdated: new Date().toISOString(),
                calendarAutoEnabled: folder.calendarAutoEnabled,
                reviewBeforeCalendarUpdate: folder.reviewBeforeCalendarUpdate,
                calendarAction: calendarHoldReason(folder),
              });
              summary.casesUpdated += 1;
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
              proofServiceMethod: responsePackage?.proofServiceMethod || parsed.proofServiceMethod || folder.proofServiceMethod || '',
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
    runningState.startedAt = 0;
  }
};

const isResponseProofDeadline = (deadline = {}) => (
  /\bresponse due:\s*proof deadline\b/i.test(String(deadline.action || ''))
);

const activeResponseDeadlineFromCase = (item = {}) => {
  const method = normalizeServiceMethodForDeadline(item.proofServiceMethod);
  const responseDate = responseDeadlineFromService(item.proofServiceDate, method) || item.responseDeadlineDate;
  if (!normalizeDate(responseDate)) {
    return null;
  }

  return {
    date: responseDate,
    time: null,
    action: `Response due: proof deadline (+${responseDeadlineDays(method)} days)`,
    priority: 'high',
    serviceMethod: method,
    responseDeadlineDays: responseDeadlineDays(method),
  };
};

const toDeadlineUi = (item) => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const activeResponseDeadline = activeResponseDeadlineFromCase(item);
  const storedDeadlines = activeResponseDeadline
    ? (item.deadlines || []).filter((deadline) => !isResponseProofDeadline(deadline))
    : (item.deadlines || []);
  const sortedDeadlines = [
    ...storedDeadlines,
    activeResponseDeadline,
  ]
    .slice()
    .filter((deadline) => normalizeDate(deadline?.date))
    .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
  const nextDeadline = activeResponseDeadline && activeResponseDeadline.date >= todayIso
    ? activeResponseDeadline
    : sortedDeadlines.find((deadline) => deadline.date >= todayIso)
    || sortedDeadlines[sortedDeadlines.length - 1]
    || null;
  const serviceMethod = item.proofServiceDate
    ? normalizeServiceMethodForDeadline(item.proofServiceMethod)
    : item.proofServiceMethod;
  const responseDeadlineDate = item.proofServiceDate
    ? responseDeadlineFromService(item.proofServiceDate, serviceMethod) || item.responseDeadlineDate
    : item.responseDeadlineDate;

  return {
    ...item,
    proofServiceMethod: serviceMethod,
    responseDeadlineDate,
    deadlines: sortedDeadlines,
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
  const cleanTitle = String(caseTitle || '').trim();
  const normalizedCaseId = safeCaseId(caseId) || folderIdFromCaseTitle(cleanTitle);
  if (!isValidCaseFolderId(normalizedCaseId)) {
    throw new Error('A valid case number or case name is required');
  }

  const stored = await getCaseRecordsFromDb();
  const existing = stored.find((item) => item.caseId === normalizedCaseId);
  const now = new Date().toISOString();
  const record = await upsertCaseRecord({
    ...(existing || {}),
    id: existing?.id || normalizedCaseId,
    caseId: normalizedCaseId,
    caseTitle: cleanTitle || existing?.caseTitle || normalizedCaseId,
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

export const approveCaseCalendarUpdate = async (caseId) => {
  const normalizedCaseId = safeCaseId(caseId);
  if (!isValidCaseFolderId(normalizedCaseId)) {
    throw new Error('A valid case number or case name is required');
  }

  const stored = await getCaseRecordsFromDb();
  const target = stored.find((item) => item.caseId === normalizedCaseId);
  if (!target) {
    return null;
  }

  const accounts = await getAllAccountsRaw();
  const account = accounts.find((entry) => entry.email === target.sourceAccount) || accounts[0];
  if (!account?.tokens) {
    throw new Error('Connected Google account not found');
  }

  const auth = getAuthClient(account.tokens, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });

  const responsePackage = buildResponsePackage({
    proofServiceDate: target.proofServiceDate,
    proofServiceMethod: target.proofServiceMethod || 'electronic',
    discoverySets: target.discoverySets || [],
    caseId: normalizedCaseId,
    caseTitle: target.caseTitle || normalizedCaseId,
  });
  const deadlines = Array.isArray(target.deadlines) ? [...target.deadlines] : [];
  if (
    responsePackage?.responseDeadline
    && !deadlines.some((item) => item.date === responsePackage.responseDeadline.date && item.action === responsePackage.responseDeadline.action)
  ) {
    deadlines.push(responsePackage.responseDeadline);
  }

  if (!deadlines.some((item) => normalizeDate(item?.date))) {
    throw new Error('No valid deadline found to add to Google Calendar');
  }

  const calendarId = target.sourceCalendarId && target.sourceCalendarId !== 'CaseSync'
    ? target.sourceCalendarId
    : defaultCalendarId;
  const payload = {
    caseId: normalizedCaseId,
    caseTitle: target.caseTitle || normalizedCaseId,
    summary: target.summary || 'CaseSync reviewed deadline package.',
    status: target.status || 'active',
    trigger: null,
    triggerName: target.triggerName || 'CaseSync review approval',
    deadlines,
    emailId: '',
    sourceEmail: account.email,
    sourceName: 'CaseSync review approval',
    caseConfidence: target.caseConfidence ?? 100,
    estimated: target.isEstimated,
    proofServiceDate: target.proofServiceDate || '',
    proofServiceMethod: responsePackage?.proofServiceMethod || target.proofServiceMethod || '',
    discoverySets: responsePackage?.discoverySets || target.discoverySets || [],
    responseDeadlineDate: responsePackage?.responseDeadlineDate || target.responseDeadlineDate || '',
    responsePackage: responsePackage?.responseDeadline ? responsePackage : null,
    raw: null,
  };

  const existing = await findEventByCaseId(auth, calendarId, normalizedCaseId);
  const event = existing?.id
    ? await updateCaseEvent(auth, calendarId, existing.id, payload)
    : await createCaseEvent(auth, calendarId, payload);

  await upsertRelatedCaseEvents(auth, calendarId, payload, event);
  const record = await upsertCaseRecord({
    ...target,
    ...payload,
    id: event.id,
    htmlLink: event.htmlLink || '',
    description: event.description || '',
    lastUpdated: event.extendedProperties?.private?.lastUpdated || event.updated || new Date().toISOString(),
    sourceAccount: account.email,
    sourceCalendarId: calendarId,
    sourceEventSummary: event.summary || '',
    start: event.start || null,
    end: event.end || null,
    calendarAutoEnabled: false,
    reviewBeforeCalendarUpdate: true,
    calendarAction: 'Google Calendar event approved manually from CaseSync review',
  });

  return {
    case: toDeadlineUi(record),
    calendarEventUrl: event.htmlLink || '',
  };
};

export const repairCaseFromStoredEmails = async (caseId) => {
  const normalizedCaseId = safeCaseId(caseId);
  if (!isValidCaseFolderId(normalizedCaseId)) {
    throw new Error('A valid case number or case name is required');
  }

  const stored = await getCaseRecordsFromDb();
  const target = stored.find((item) => item.caseId === normalizedCaseId);
  if (!target) {
    return null;
  }

  const emails = await getCaseEmailRecords(normalizedCaseId, 100);
  const discoveryEmail = emails.find((email) => {
    const raw = email.raw || {};
    return hasReliableDiscoveryDeadlineSource(
      {
        subject: email.subject,
        snippet: email.snippet,
        body: email.bodyPreview,
      },
      {
        proofServiceDate: raw.proofServiceDate,
        discoverySets: raw.discoverySets || [],
        summary: raw.parsedSummary || raw.aiAnalysis?.summary || '',
      },
    );
  });

  if (!discoveryEmail) {
    const cleanedDeadlines = (target.deadlines || []).filter((deadline) => (
      !/^response due:\s*proof deadline/i.test(String(deadline?.action || ''))
      && !deadlineMentionsDifferentCase(deadline, target, stored)
    ));
    const record = await upsertCaseRecord({
      ...target,
      deadlines: cleanedDeadlines,
      replaceDeadlines: true,
      proofServiceDate: '',
      proofServiceMethod: '',
      responseDeadlineDate: '',
      discoverySets: [],
      responsePackage: null,
      lastUpdated: new Date().toISOString(),
      calendarAutoEnabled: false,
      reviewBeforeCalendarUpdate: true,
      calendarAction: 'Invalid discovery response deadline cleared; no reliable proof/discovery email source found.',
    });

    return {
      case: toDeadlineUi(record),
      repaired: false,
      cleared: true,
      reason: 'No stored email had both a proof date and written discovery sets.',
    };
  }

  const raw = discoveryEmail.raw || {};
  const responsePackage = buildResponsePackage({
    proofServiceDate: raw.proofServiceDate,
    proofServiceMethod: raw.proofServiceMethod || 'electronic',
    discoverySets: raw.discoverySets || [],
    caseId: normalizedCaseId,
    caseTitle: target.caseTitle || normalizedCaseId,
  });

  if (!responsePackage?.responseDeadline) {
    return {
      case: toDeadlineUi(target),
      repaired: false,
      reason: 'Stored discovery email did not produce a valid response deadline package.',
    };
  }

  const deadlines = [responsePackage.responseDeadline];

  const record = await upsertCaseRecord({
    ...target,
    caseId: normalizedCaseId,
    caseTitle: target.caseTitle || normalizedCaseId,
    summary: raw.parsedSummary || target.summary || 'Repaired from stored discovery email.',
    deadlines,
    replaceDeadlines: true,
    caseConfidence: Math.max(Number(target.caseConfidence || 0), Number(discoveryEmail.caseConfidence || 0), 86),
    isEstimated: false,
    proofServiceDate: raw.proofServiceDate,
    proofServiceMethod: responsePackage.proofServiceMethod,
    discoverySets: responsePackage.discoverySets,
    responseDeadlineDate: responsePackage.responseDeadlineDate,
    responsePackage,
    sourceAccount: discoveryEmail.accountEmail || target.sourceAccount || '',
    sourceCalendarId: target.sourceCalendarId || defaultCalendarId,
    sourceEventSummary: target.sourceEventSummary || '',
    lastUpdated: new Date().toISOString(),
    calendarAutoEnabled: false,
    reviewBeforeCalendarUpdate: true,
    calendarAction: `Discovery package repaired from stored email: ${discoveryEmail.subject || discoveryEmail.messageId}`,
  });

  return {
    case: toDeadlineUi(record),
    repaired: true,
    sourceEmail: {
      subject: discoveryEmail.subject || '',
      from: discoveryEmail.fromEmail || '',
      receivedAt: discoveryEmail.receivedAt || '',
    },
  };
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
