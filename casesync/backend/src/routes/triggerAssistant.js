import { Anthropic } from '@anthropic-ai/sdk';
import express from 'express';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const readBoundedInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
};
const OUTPUT_TOKENS = readBoundedInt(process.env.TRIGGER_AI_MAX_OUTPUT_TOKENS, 520, 300, 700);

const DEFAULT_PATTERNS = [
  '(?:Case\\s*(?:No\\.?|Number)|Docket\\s*(?:No\\.?|Number))[:#\\s-]*([A-Z0-9-]+)',
  '\\b\\d{2}[A-Z]{2,5}\\d{4,}\\b',
  '\\b\\d{7,12}\\b',
];

const PRESETS = {
  discovery: {
    name: 'Discovery proof of service',
    senderEmails: [],
    keywords: [
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
    ],
    caseIdPatterns: DEFAULT_PATTERNS,
    calendarId: 'primary',
    enabled: true,
  },
  court: {
    name: 'Court / CMC / hearing notices',
    senderEmails: [],
    keywords: [
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
    ],
    caseIdPatterns: DEFAULT_PATTERNS,
    calendarId: 'primary',
    enabled: true,
  },
  vendor: {
    name: 'Vendor deadline / payment notices',
    senderEmails: [],
    keywords: [
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
    ],
    caseIdPatterns: DEFAULT_PATTERNS,
    calendarId: 'primary',
    enabled: true,
  },
};

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || '').match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const uniqueStrings = (items = []) => [...new Set((items || [])
  .map((item) => String(item || '').trim())
  .filter(Boolean))]
  .slice(0, 18);

const sanitizeTrigger = (draft = {}, accountEmails = []) => {
  const name = String(draft.name || '').trim() || 'AI suggested Gmail rule';
  const senderEmails = uniqueStrings(draft.senderEmails).filter((item) => /@/.test(item));
  const keywords = uniqueStrings(draft.keywords);
  const caseIdPatterns = uniqueStrings(draft.caseIdPatterns).length
    ? uniqueStrings(draft.caseIdPatterns).slice(0, 6)
    : DEFAULT_PATTERNS;
  const calendarId = String(draft.calendarId || 'primary').trim() || 'primary';

  return {
    name: name.slice(0, 90),
    senderEmails,
    keywords: keywords.length ? keywords : PRESETS.discovery.keywords,
    caseIdPatterns,
    calendarId,
    enabled: draft.enabled !== false,
    accountEmail: accountEmails.includes(draft.accountEmail) ? draft.accountEmail : accountEmails[0] || '',
  };
};

const heuristicDraft = (message = '', accountEmails = []) => {
  const lower = message.toLowerCase();
  const preset = lower.includes('court') || lower.includes('cmc') || lower.includes('hearing') || lower.includes('notice')
    ? PRESETS.court
    : lower.includes('vendor') || lower.includes('invoice') || lower.includes('payment') || lower.includes('sugarsync')
      ? PRESETS.vendor
      : PRESETS.discovery;

  const emails = uniqueStrings(message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);

  return sanitizeTrigger({
    ...preset,
    senderEmails: emails,
    accountEmail: accountEmails[0] || '',
  }, accountEmails);
};

router.post('/suggest', async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 1600);
  const accountEmails = uniqueStrings(req.body?.accountEmails || []);

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({
      source: 'rule_fallback',
      reply: 'I prepared a safe default rule without AI. Review it, then create the rule and scan inboxes.',
      trigger: heuristicDraft(message, accountEmails),
    });
  }

  const prompt = [
    'You build Gmail scan trigger rules for CaseSync, a legal deadline assistant.',
    'The user describes what emails to watch. Return a conservative trigger only; do not create calendar events.',
    'Calendar writes require later human review. The rule should only decide which emails CaseSync scans.',
    '',
    `Connected Gmail accounts: ${accountEmails.join(', ') || 'unknown'}`,
    '',
    `User request: ${message}`,
    '',
    'Return ONLY JSON:',
    '{',
    '  "reply": "short plain-English explanation",',
    '  "trigger": {',
    '    "name": "short rule name",',
    '    "senderEmails": ["optional exact senders"],',
    '    "keywords": ["keywords to search in subject/body"],',
    '    "caseIdPatterns": ["regex patterns"],',
    '    "calendarId": "primary",',
    '    "enabled": true,',
    '    "accountEmail": "one connected Gmail account or empty"',
    '  }',
    '}',
    '',
    'Rules:',
    '- Include proof of service/discovery keywords for discovery requests.',
    '- Include court notice/CMC/hearing keywords for court notices.',
    '- Include invoice/payment/upload/deadline keywords for vendors.',
    '- Always include common case ID regex patterns.',
    '- Keep keywords concise and avoid broad words like legal, email, document unless needed.',
  ].join('\n');

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: OUTPUT_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = parseJson(response?.content?.[0]?.text || '{}') || {};
    res.json({
      source: 'ai',
      model: MODEL,
      reply: String(parsed.reply || 'I drafted a trigger. Please review it before creating.').slice(0, 240),
      trigger: sanitizeTrigger(parsed.trigger || {}, accountEmails),
    });
  } catch (error) {
    res.json({
      source: 'rule_fallback',
      reply: 'AI could not draft this rule, so I prepared a safe default based on your request.',
      trigger: heuristicDraft(message, accountEmails),
    });
  }
});

export default router;
