import { Anthropic } from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const readBoundedInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
};

const AI_MAX_INPUT_CHARS = readBoundedInt(process.env.AI_MAX_INPUT_CHARS, 6500, 1800, 16000);
const AI_MAX_OUTPUT_TOKENS = readBoundedInt(process.env.AI_MAX_OUTPUT_TOKENS, 800, 350, 1200);

const AI_RELEVANCE_KEYWORDS = [
  'proof of service',
  'court eservice',
  'service of',
  'served',
  'discovery',
  'interrogator',
  'requests for production',
  'request for production',
  'requests for admission',
  'request for admission',
  'rfp',
  'rfa',
  'e-rog',
  'g-rog',
  'hearing',
  'notice',
  'case management conference',
  'cmc',
  'trial',
  'mediation',
  'arbitration',
  'deadline',
  'due',
  'calendar',
  'meet and confer',
  'vendor',
  'invoice',
  'payment',
];

const CASE_CONFIDENCE_CONFIRM_THRESHOLD = 80;

const normalizeDate = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim();
  const m = candidate.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})$/);
  if (!m) {
    return null;
  }

  const normalized = `${m[1]}-${m[2]}-${m[3]}`;
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (
    date.getUTCFullYear() !== Number(m[1])
    || date.getUTCMonth() + 1 !== Number(m[2])
    || date.getUTCDate() !== Number(m[3])
  ) {
    return null;
  }
  return normalized;
};

const MONTHS = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sep: '09',
  sept: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
};

const pad2 = (value) => String(value || '').padStart(2, '0');

const normalizeFlexibleDate = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim().replace(/,/g, '');
  const iso = normalizeDate(candidate.replace(/[./]/g, '-'));
  if (iso) {
    return iso;
  }

  const slash = candidate.match(/\b(\d{1,2})[/-](\d{1,2})[/-]([12]\d{3})\b/);
  if (slash) {
    return normalizeDate(`${slash[3]}-${pad2(slash[1])}-${pad2(slash[2])}`);
  }

  const monthFirst = candidate.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([12]\d{3})\b/i);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    if (month) {
      return normalizeDate(`${monthFirst[3]}-${month}-${pad2(monthFirst[2])}`);
    }
  }

  const dayFirst = candidate.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+([12]\d{3})\b/i);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    if (month) {
      return normalizeDate(`${dayFirst[3]}-${month}-${pad2(dayFirst[1])}`);
    }
  }

  return null;
};

const normalizeTime = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim();
  return /^\d{2}:\d{2}$/.test(candidate) ? candidate : null;
};

const normalizePriority = (value) => {
  if (value === 'high' || value === 'low' || value === 'medium') {
    return value;
  }
  return 'medium';
};

const parseIntSafe = (value) => {
  const num = Number.parseInt(String(value || '').replace(/[^0-9-]/g, ''), 10);
  if (Number.isNaN(num)) {
    return null;
  }
  return Math.max(0, Math.min(100, num));
};

const parseBoolean = (value) => {
  if (value === true || value === false) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value === 1;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['true', 'yes', 'y', '1'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', '0'].includes(normalized)) {
    return false;
  }
  return null;
};

const normalizeServiceMethod = (value) => {
  const method = String(value || '').trim().toLowerCase();
  if (!method) {
    return null;
  }

  if (/\b(personal(?:ly)?|in person|in-person|hand[-\s]?deliver(?:y|ed)?|in-hand)\b/.test(method)) {
    return 'personal';
  }
  if (/\b(e[-\s]?service|electronic(?:ally)?|email(?:ed|ing)?|e-mail(?:ed|ing)?|via email|electronic mail|electronic transmission)\b/.test(method)) {
    return 'electronic';
  }
  if (/\b(served by mail|service by mail|by mail|u\.?s\.?\s+mail|first[-\s]?class mail|regular mail|postal|mailed)\b/.test(method)) {
    return 'mail';
  }

  return null;
};

const DISCOVERY_SET_RULES = [
  {
    label: 'E-rogs',
    regex: /\b(e[-\s]?rogs?|employment interrogator(?:y|ies)|special interrogator(?:y|ies))\b/i,
  },
  {
    label: 'G-rogs',
    regex: /\b(g[-\s]?rogs?|general interrogator(?:y|ies)|form interrogator(?:y|ies)|frogs?)\b/i,
  },
  {
    label: 'RFPs',
    regex: /\b(rfps?|requests?\s+for\s+production|production\s+of\s+documents?)\b/i,
  },
  {
    label: 'RFAs',
    regex: /\b(rfas?|requests?\s+for\s+admissions?)\b/i,
  },
];

const normalizeDiscoveryLabel = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return null;
  }

  if (/e[-\s]?rogs?|employment interrogator|special interrogator/.test(text)) {
    return 'E-rogs';
  }
  if (/g[-\s]?rogs?|general interrogator|form interrogator|frogs?/.test(text)) {
    return 'G-rogs';
  }
  if (/rfps?|requests?\s+for\s+production|production\s+of\s+documents?/.test(text)) {
    return 'RFPs';
  }
  if (/rfas?|requests?\s+for\s+admissions?/.test(text)) {
    return 'RFAs';
  }

  return String(value).trim();
};

const extractDiscoverySetsFromText = (text = '') => {
  const found = [];
  for (const rule of DISCOVERY_SET_RULES) {
    if (rule.regex.test(text)) {
      found.push(rule.label);
    }
  }
  return [...new Set(found)];
};

const normalizeDiscoverySets = (items, fallbackText = '') => {
  const normalized = Array.isArray(items)
    ? items.map(normalizeDiscoveryLabel).filter(Boolean)
    : [];
  const fallback = extractDiscoverySetsFromText(fallbackText);
  return [...new Set([...normalized, ...fallback])];
};

const regexFromPattern = (pattern) => {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
};

const DEFAULT_CASE_ID_PATTERNS = [
  String.raw`(?:case\s*(?:no\.?|number|#)|docket\s*(?:no\.?|number|#))[:#\s-]*([A-Z0-9][A-Z0-9-]{4,})`,
  String.raw`\b(\d{7,12})\b`,
  String.raw`\b(\d{2}[A-Z]{2,5}\d{4,})\b`,
  String.raw`\b([A-Z]{2,5}-\d{4,}-[A-Z0-9-]+)\b`,
  String.raw`\b([A-Z]{2,5}\d{6,})\b`,
];

const normalizeCaseIdCandidate = (value) => {
  const candidate = String(value || '').trim().replace(/[.,;:)]+$/g, '');
  if (candidate.length < 5) {
    return null;
  }
  if (!/[0-9]/.test(candidate)) {
    return null;
  }
  if (!/[A-Za-z]/.test(candidate) && candidate.length < 7) {
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(candidate)) {
    return null;
  }
  return candidate;
};

const extractWithRegex = ({ body, subject, from, caseIdPatterns = [] }) => {
  const text = `${subject}\n${from}\n${body}`;
  const patterns = [...caseIdPatterns, ...DEFAULT_CASE_ID_PATTERNS];
  for (const pattern of patterns) {
    const regex = regexFromPattern(pattern);
    if (!regex) {
      continue;
    }

    const match = text.match(regex);
    if (!match) {
      continue;
    }

    if (match[1]) {
      const value = normalizeCaseIdCandidate(match[1]);
      if (value) {
        return value;
      }
    }

    if (match[0]) {
      const value = normalizeCaseIdCandidate(match[0]);
      if (value) {
        return value;
      }
    }
  }

  return null;
};

const parseJson = (raw) => {
  const text = String(raw || '').replace(/```json|```/g, '').trim();
  const found = text.match(/\{[\s\S]*\}/);
  if (!found) {
    return null;
  }

  try {
    return JSON.parse(found[0]);
  } catch {
    return null;
  }
};

const parseProofDateFromText = (text = '') => {
  const sample = text.toLowerCase();
  const patterns = [
    /proof of service.{0,80}?((?:[12]\d{3}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{1,2}[/-]\d{1,2}[/-][12]\d{3})|(?:[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+[12]\d{3}))/i,
    /date of service.{0,60}?((?:[12]\d{3}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{1,2}[/-]\d{1,2}[/-][12]\d{3})|(?:[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+[12]\d{3}))/i,
    /served.{0,60}?((?:[12]\d{3}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{1,2}[/-]\d{1,2}[/-][12]\d{3})|(?:[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+[12]\d{3}))/i,
    /pos.{0,60}?((?:[12]\d{3}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{1,2}[/-]\d{1,2}[/-][12]\d{3})|(?:[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+[12]\d{3}))/i,
    /((?:[12]\d{3}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{1,2}[/-]\d{1,2}[/-][12]\d{3})|(?:[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+[12]\d{3})).{0,60}(electronic|email|e-?service|mail|personal|hand)/i,
  ];

  for (const pattern of patterns) {
    const match = sample.match(pattern);
    if (!match) {
      continue;
    }

    const date = normalizeFlexibleDate(match[1] || match[0]);
    if (!date) {
      continue;
    }

    if (match[2]) {
      const method = normalizeServiceMethod(match[2]);
      return { date, method: method || null };
    }

    const contextStart = Math.max(0, match.index - 120);
    const contextEnd = Math.min(sample.length, match.index + match[0].length + 120);
    const methodContext = sample.slice(contextStart, contextEnd);
    return { date, method: normalizeServiceMethod(methodContext) || null };
  }

  return { date: null, method: null };
};

const hasDiscoveryServiceLanguage = (text = '') => {
  return /\b(proof of service|date of service|served|serving|service of|e-?service|electronic service|mail service)\b/i.test(text)
    && /\b(discovery|interrogator(?:y|ies)|requests?\s+for\s+(?:production|admissions?)|rfps?|rfas?|e[-\s]?rogs?|g[-\s]?rogs?)\b/i.test(text);
};

const isRuleBasedDiscoveryReady = ({ caseId, proofServiceDate, discoverySets, fullText }) => {
  return Boolean(
    caseId
    && proofServiceDate
    && Array.isArray(discoverySets)
    && discoverySets.length > 0
    && hasDiscoveryServiceLanguage(fullText),
  );
};

const extractCaseIdConfidence = (matchValue) => {
  if (!normalizeCaseIdCandidate(matchValue)) {
    return 45;
  }
  return 86;
};

const resolveEstimated = (estimatedInput, hasHintCaseId, caseConfidence) => {
  const parsed = parseBoolean(estimatedInput);
  if (parsed !== null) {
    return parsed;
  }

  if (hasHintCaseId) {
    return false;
  }

  if (!Number.isFinite(caseConfidence)) {
    return true;
  }

  return caseConfidence < CASE_CONFIDENCE_CONFIRM_THRESHOLD;
};

const normalizeAiText = (value) => String(value || '')
  .replace(/\r/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const hasAiRelevantSignal = (value) => {
  const lower = String(value || '').toLowerCase();
  return AI_RELEVANCE_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const buildAiEmailBody = ({ body = '' }) => {
  const normalized = normalizeAiText(body);
  if (!normalized) {
    return '';
  }

  const flattened = normalized.replace(/\s+/g, ' ');
  const lower = flattened.toLowerCase();
  const ranges = [{ start: 0, end: Math.min(flattened.length, 1400) }];

  for (const keyword of AI_RELEVANCE_KEYWORDS) {
    let searchFrom = 0;
    let matches = 0;

    while (matches < 4) {
      const index = lower.indexOf(keyword, searchFrom);
      if (index < 0) {
        break;
      }

      ranges.push({
        start: Math.max(0, index - 750),
        end: Math.min(flattened.length, index + keyword.length + 1250),
      });

      searchFrom = index + keyword.length;
      matches += 1;
    }
  }

  const merged = ranges
    .sort((a, b) => a.start - b.start)
    .reduce((acc, range) => {
      const last = acc[acc.length - 1];
      if (last && range.start <= last.end + 120) {
        last.end = Math.max(last.end, range.end);
      } else {
        acc.push({ ...range });
      }
      return acc;
    }, []);

  return merged
    .map((range) => flattened.slice(range.start, range.end).trim())
    .filter(Boolean)
    .join('\n\n--- relevant excerpt ---\n\n')
    .slice(0, AI_MAX_INPUT_CHARS);
};

export const parseEmail = async ({ subject = '', body = '', from = '', date = '', caseIdPatterns = [] }) => {
  const hintCaseId = extractWithRegex({ body, subject, from, caseIdPatterns });
  const fullText = `${subject}\n${from}\n${body}`;
  const fallback = parseProofDateFromText(fullText);
  const fallbackDiscoverySets = extractDiscoverySetsFromText(fullText);
  const aiRelevant = hasAiRelevantSignal(fullText);
  const aiBody = buildAiEmailBody({ body });

  const prompt = [
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Analyze these cost-controlled legal email excerpts and decide whether CaseSync should propose calendar items.',
    'Use only the provided text. Do not invent deadlines, case numbers, proof dates, or service methods.',
    'If there is no scheduling action, return hasActionableDeadline false and an empty deadlines array.',
    'If this is written discovery served with proof of service, extract proofServiceDate and proofServiceMethod. CaseSync will calculate the response deadline separately.',
    'Service method must be one of: personal, electronic, mail, or null. Personal service means 30 days total. Electronic service means 32 days total. Mail service means 35 days total where applicable.',
    'Default to electronic when the service method is unclear, because this practice normally receives service electronically. Only return personal or mail when the email/proof text clearly says personal service or service by mail.',
    'Do not calculate the discovery response deadline yourself unless the email states a separate explicit deadline; CaseSync calculates it from proofServiceDate + proofServiceMethod.',
    '',
    'Email:',
    `From: ${from}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    '',
    'Relevant body excerpts:',
    aiBody || '[No body text extracted]',
    '',
    hintCaseId ? `Hint case IDs: ${hintCaseId}` : null,
    hintCaseId ? '' : null,
    'If this email includes proof-of-service / service of docs, find proofServiceDate (YYYY-MM-DD) and proofServiceMethod (personal/electronic/mail).',
    'If the email serves discovery, identify discoverySets using short labels such as E-rogs, G-rogs, RFPs, and RFAs.',
    'Only return discoverySets that are clearly present. Do not return generic labels like "Discovery responses" unless the email clearly says written discovery was served but does not identify the specific set.',
    'Return ONLY this JSON (no other text):',
    '{',
    '  "caseId": "extracted case/docket/reference number or null",',
    '  "caseTitle": "brief title describing the case",',
    '  "deadlines": [',
    '    {',
    '      "date": "YYYY-MM-DD",',
    '      "time": "HH:MM or null",',
    '      "action": "what needs to be done",',
    '      "priority": "high|medium|low"',
    '    }',
    '  ],',
    '  "summary": "2-3 sentence summary of what this email requires",',
    '  "status": "active|pending|closed",',
    '  "hasActionableDeadline": true/false,',
    '  "estimated": true/false,',
    '  "caseConfidence": 0,',
    '  "discoverySets": ["E-rogs", "G-rogs", "RFPs", "RFAs"],',
    '  "proofServiceDate": "YYYY-MM-DD or null",',
    '  "proofServiceMethod": "personal|electronic|mail|null"',
    '}',
  ].filter(Boolean).join('\n');

  let data = {
    caseId: hintCaseId,
    caseTitle: `Case from ${from || 'unknown sender'}`,
    deadlines: [],
    summary: '',
    status: 'active',
    hasActionableDeadline: false,
    caseConfidence: hintCaseId ? extractCaseIdConfidence(hintCaseId) : 50,
    discoverySets: fallbackDiscoverySets,
    proofServiceDate: fallback.date,
    proofServiceMethod: fallback.method,
    estimated: hintCaseId ? false : true,
    parserSource: 'rule_fallback',
    aiAnalysis: null,
  };

  try {
    const ruleBasedReady = isRuleBasedDiscoveryReady({
      caseId: hintCaseId,
      proofServiceDate: data.proofServiceDate,
      discoverySets: data.discoverySets,
      fullText,
    });

    if (ruleBasedReady) {
      data = {
        ...data,
        caseId: hintCaseId,
        summary: 'Rule-based discovery service match. CaseSync detected proof of service, discovery set labels, and a case identifier without AI.',
        hasActionableDeadline: true,
        caseConfidence: extractCaseIdConfidence(data.caseId),
        estimated: false,
        parserSource: 'rule_based',
        aiAnalysis: {
          usedAi: false,
          model: null,
          inputMode: 'rule_based_no_ai',
          inputChars: 0,
          maxOutputTokens: 0,
          costGuard: 'rule_based_first',
          summary: 'Rule-based parser detected proof of service, discovery set labels, and a case identifier. AI was not used for this email.',
          extracted: {
            caseId: hintCaseId,
            proofServiceDate: data.proofServiceDate || '',
            proofServiceMethod: data.proofServiceMethod || '',
            discoverySets: data.discoverySets || [],
            hasActionableDeadline: true,
          },
        },
      };
      throw new Error('Rule-based parser completed');
    }

    if (!aiRelevant) {
      data.aiAnalysis = {
        usedAi: false,
        model: null,
        inputMode: 'skipped_no_scheduling_signal',
        inputChars: 0,
        maxOutputTokens: 0,
        costGuard: 'keyword_gate',
        summary: 'AI was skipped because the email did not contain legal scheduling or deadline keywords.',
        extracted: {
          caseId: hintCaseId || '',
          proofServiceDate: data.proofServiceDate || '',
          proofServiceMethod: data.proofServiceMethod || '',
          discoverySets: data.discoverySets || [],
          hasActionableDeadline: false,
        },
      };
      throw new Error('AI skipped: no scheduling signal');
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Missing ANTHROPIC_API_KEY');
    }

    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: AI_MAX_OUTPUT_TOKENS,
      messages: [{
        role: 'user',
        content: prompt,
      }],
    });

    const parsed = parseJson(response?.content?.[0]?.text || '{}');
    if (parsed) {
      const caseId = normalizeCaseIdCandidate(parsed.caseId) || hintCaseId;
      const caseConfidence = parseIntSafe(parsed.caseConfidence) ?? (caseId ? extractCaseIdConfidence(caseId) : data.caseConfidence);

      data = {
        caseId,
        caseTitle: typeof parsed.caseTitle === 'string' && parsed.caseTitle.trim() ? parsed.caseTitle.trim() : data.caseTitle,
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
        status: parsed.status === 'closed' ? 'closed' : parsed.status === 'pending' ? 'pending' : 'active',
        hasActionableDeadline: parsed.hasActionableDeadline === true,
        caseConfidence,
        discoverySets: normalizeDiscoverySets(parsed.discoverySets, fullText),
        proofServiceDate: normalizeDate(parsed.proofServiceDate) || data.proofServiceDate,
        proofServiceMethod: normalizeServiceMethod(parsed.proofServiceMethod) || data.proofServiceMethod,
        estimated: resolveEstimated(parsed.estimated, Boolean(hintCaseId), caseConfidence),
        deadlines: Array.isArray(parsed.deadlines)
          ? parsed.deadlines.map((deadline) => ({
            date: normalizeDate(deadline.date),
            time: normalizeTime(deadline.time),
            action: typeof deadline.action === 'string' ? deadline.action.trim() : 'Follow this request',
            priority: normalizePriority(deadline.priority),
          })).filter((deadline) => Boolean(deadline.date))
          : [],
        parserSource: 'ai_fallback',
        aiAnalysis: {
          usedAi: true,
          model: ANTHROPIC_MODEL,
          inputMode: 'compressed_relevant_excerpts',
          inputChars: aiBody.length,
          maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
          costGuard: 'rule_based_first_keyword_gate_snippet_only',
          summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
          extracted: {
            caseId,
            caseTitle: typeof parsed.caseTitle === 'string' ? parsed.caseTitle.trim() : '',
            status: parsed.status || '',
            caseConfidence,
            estimated: resolveEstimated(parsed.estimated, Boolean(hintCaseId), caseConfidence),
            hasActionableDeadline: parsed.hasActionableDeadline === true,
            proofServiceDate: normalizeDate(parsed.proofServiceDate) || data.proofServiceDate || '',
            proofServiceMethod: normalizeServiceMethod(parsed.proofServiceMethod) || data.proofServiceMethod || '',
            discoverySets: normalizeDiscoverySets(parsed.discoverySets, fullText),
            deadlines: Array.isArray(parsed.deadlines) ? parsed.deadlines : [],
          },
        },
      };
    }
  } catch (error) {
    data.caseId = hintCaseId || normalizeCaseIdCandidate(data.caseId);
  }

  data.caseId = normalizeCaseIdCandidate(data.caseId);

  if (!Number.isFinite(data.caseConfidence)) {
    data.caseConfidence = data.caseId ? extractCaseIdConfidence(data.caseId) : 50;
  }

  if (typeof data.estimated !== 'boolean') {
    data.estimated = resolveEstimated(data.estimated, Boolean(hintCaseId || data.caseId), data.caseConfidence);
  }

  data.discoverySets = normalizeDiscoverySets(data.discoverySets, fullText);

  if (!data.caseTitle || data.caseTitle.length > 180) {
    data.caseTitle = `Case from ${from || subject || 'email'}`.slice(0, 180);
  }

  if (!data.hasActionableDeadline && data.caseId && data.proofServiceDate && data.proofServiceMethod) {
    data.hasActionableDeadline = true;
  }

  return data;
};
