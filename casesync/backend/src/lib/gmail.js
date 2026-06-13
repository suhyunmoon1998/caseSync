import { google } from 'googleapis';

const decodeHtmlEntities = (value = '') => {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

export const getAuthClient = (tokens, { clientId, clientSecret, redirectUri }) => {
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials(tokens || {});
  return auth;
};

const normalizeBase64 = (data) => {
  if (!data || typeof data !== 'string') {
    return '';
  }
  const cleaned = data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const padded = (4 - (cleaned.length % 4)) % 4;
  return `${cleaned}${'='.repeat(padded)}`;
};

export const decodeBody = (data = '') => {
  if (!data || typeof data !== 'string') {
    return '';
  }
  try {
    return decodeHtmlEntities(Buffer.from(normalizeBase64(data), 'base64').toString('utf8').replace(/\u0000/g, ''));
  } catch (error) {
    try {
      return decodeHtmlEntities(Buffer.from(normalizeBase64(String(data)), 'base64').toString('ascii').replace(/\u0000/g, ''));
    } catch {
      return '';
    }
  }
};

const collectTextFromPayload = (node) => {
  if (!node) {
    return '';
  }

  const mime = (node.mimeType || '').toLowerCase();
  const headers = node.headers || [];
  const charsetHeader = headers.find((header) => header.name.toLowerCase() === 'content-type');

  if (node.body?.data && (!node.parts || node.parts.length === 0)) {
    if (mime.includes('text/plain') || mime.includes('text/html')) {
      const raw = decodeBody(node.body.data);
      return mime.includes('text/html')
        ? raw.replace(/<[^>]*>/g, '\n').replace(/\n{3,}/g, '\n\n')
        : raw;
    }
  }

  if (node.parts?.length) {
    const textPlain = node.parts.find((item) => item.mimeType === 'text/plain');
    const best = textPlain || node.parts.find((item) => item.mimeType === 'text/html');
    if (best) {
      return collectTextFromPayload(best);
    }

    return node.parts.map((item) => collectTextFromPayload(item)).join('\n').trim();
  }

  return '';
};

export const extractText = (payload = {}) => {
  return collectTextFromPayload(payload)
    .replace(/\r/g, '')
    .replace(/\u200b/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const getEmailDetail = async (auth, messageId) => {
  const gmail = google.gmail({ version: 'v1', auth });
  const message = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return message.data;
};

const escapeQueryTerm = (value = '') => {
  return String(value).replace(/[\"']/g, '\\$&');
};

const buildQuery = (trigger) => {
  const fromPart = Array.isArray(trigger.senderEmails) && trigger.senderEmails.length
    ? `from:(${trigger.senderEmails.map((item) => `"${escapeQueryTerm(item)}"`).join(' OR ')})`
    : '';

  const keywordPart = Array.isArray(trigger.keywords) && trigger.keywords.length
    ? `(${trigger.keywords.map((item) => `"${escapeQueryTerm(item)}"`).join(' OR ')})`
    : '';

  const recent = 'newer_than:7d';
  const constraints = ['(is:unread OR newer_than:7d)'];

  if (fromPart) {
    constraints.push(fromPart);
  }
  if (keywordPart) {
    constraints.push(keywordPart);
  }

  return `${constraints.join(' ')} ${recent}`.trim();
};

export const fetchTriggerEmails = async (auth, trigger, maxResults = 50) => {
  const gmail = google.gmail({ version: 'v1', auth });
  const query = buildQuery(trigger);

  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const items = data.messages || [];
  const resolved = [];

  for (const item of items) {
    const messageId = item.id;
    const msg = await getEmailDetail(auth, messageId);
    const headers = msg.payload?.headers || [];
    const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    resolved.push({
      id: messageId,
      threadId: msg.threadId,
      subject: getHeader('subject') || '(No Subject)',
      from: getHeader('from') || '(No From)',
      date: getHeader('date') || new Date().toISOString(),
      snippet: msg.snippet || '',
      body: extractText(msg.payload),
    });
  }

  return resolved;
};
