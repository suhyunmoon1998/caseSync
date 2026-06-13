import { Anthropic } from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  return Number.isNaN(date.getTime()) ? null : normalized;
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

  if (method.includes('personal') || method.includes('in person') || method.includes('hand') || method.includes('in-hand')) {
    return 'personal';
  }
  if (method.includes('electronic') || method.includes('email') || method.includes('e-service') || method.includes('e service') || method.includes('e-rogs') || method.includes('e-rog')) {
    return 'electronic';
  }
  if (method.includes('mail') || method.includes('postal') || method.includes('served by mail')) {
    return 'mail';
  }

  return method;
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

const extractWithRegex = ({ body, subject, from, caseIdPatterns = [] }) => {
  const text = `${subject}\n${from}\n${body}`;
  for (const pattern of caseIdPatterns) {
    const regex = regexFromPattern(pattern);
    if (!regex) {
      continue;
    }

    const match = text.match(regex);
    if (!match) {
      continue;
    }

    if (match[1]) {
      const value = String(match[1]).trim();
      if (value) {
        return value;
      }
    }

    if (match[0]) {
      const value = String(match[0]).trim();
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
    /proof of service[^\d]*([12]\d{3}[/-]\d{1,2}[/-]\d{1,2})/i,
    /served[^\d]*([12]\d{3}[/-]\d{1,2}[/-]\d{1,2})/i,
    /pos[^\d]*([12]\d{3}[/-]\d{1,2}[/-]\d{1,2})/i,
    /(\d{4}-\d{2}-\d{2}).{0,40}(electronic|email|e-?service)/i,
  ];

  for (const pattern of patterns) {
    const match = sample.match(pattern);
    if (!match) {
      continue;
    }

    const date = normalizeDate((match[1] || match[0])?.replace(/[./]/g, '-'));
    if (!date) {
      continue;
    }

    if (match[2]) {
      const method = normalizeServiceMethod(match[2]);
      return { date, method: method || null };
    }

    return { date, method: normalizeServiceMethod(sample) || null };
  }

  return { date: null, method: null };
};

const extractCaseIdConfidence = (matchValue) => {
  if (!matchValue) {
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

export const parseEmail = async ({ subject = '', body = '', from = '', date = '', caseIdPatterns = [] }) => {
  const hintCaseId = extractWithRegex({ body, subject, from, caseIdPatterns });
  const fullText = `${subject}\n${from}\n${body}`;
  const fallback = parseProofDateFromText(fullText);
  const fallbackDiscoverySets = extractDiscoverySetsFromText(fullText);

  const prompt = [
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Analyze this email and extract all actionable information.',
    '',
    'Email:',
    `From: ${from}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    '',
    'Body:',
    body,
    '',
    hintCaseId ? `Hint case IDs: ${hintCaseId}` : null,
    hintCaseId ? '' : null,
    'If this email includes proof-of-service / service of docs, find proofServiceDate (YYYY-MM-DD) and proofServiceMethod (personal/electronic/mail).',
    'If the email serves discovery, identify discoverySets using short labels such as E-rogs, G-rogs, RFPs, and RFAs.',
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
    caseId: null,
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
  };

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Missing ANTHROPIC_API_KEY');
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1400,
      messages: [{
        role: 'user',
        content: prompt,
      }],
    });

    const parsed = parseJson(response?.content?.[0]?.text || '{}');
    if (parsed) {
      const caseId = typeof parsed.caseId === 'string' && parsed.caseId.trim() ? parsed.caseId.trim() : hintCaseId;
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
      };
    }
  } catch {
    data.caseId = hintCaseId || data.caseId;
  }

  if (!data.caseId) {
    data.caseId = null;
  }

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
