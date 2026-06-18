import { google } from 'googleapis';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const attachmentTextMaxChars = Number(process.env.ATTACHMENT_TEXT_MAX_CHARS || 60000);

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

const collectAttachmentParts = (node, collected = []) => {
  if (!node) {
    return collected;
  }

  const filename = String(node.filename || '').trim();
  const attachmentId = node.body?.attachmentId || '';
  const inlineData = node.body?.data || '';
  if (filename && (attachmentId || inlineData)) {
    collected.push({
      filename,
      mimeType: node.mimeType || '',
      attachmentId,
      inlineData,
      size: node.body?.size || 0,
    });
  }

  for (const part of node.parts || []) {
    collectAttachmentParts(part, collected);
  }

  return collected;
};

const attachmentKind = (filename = '', mimeType = '') => {
  const name = filename.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (
    mime.includes('wordprocessingml.document')
    || mime.includes('msword')
    || name.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (mime.includes('text/plain') || name.endsWith('.txt') || name.endsWith('.csv')) {
    return 'text';
  }
  if (mime.includes('text/html') || name.endsWith('.html') || name.endsWith('.htm')) {
    return 'html';
  }
  return 'unsupported';
};

const attachmentDataBuffer = async (auth, messageId, part) => {
  if (part.inlineData) {
    return Buffer.from(normalizeBase64(part.inlineData), 'base64');
  }

  if (!part.attachmentId) {
    return null;
  }

  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: part.attachmentId,
  });

  if (!data?.data) {
    return null;
  }

  return Buffer.from(normalizeBase64(data.data), 'base64');
};

const extractAttachmentText = async (buffer, kind) => {
  if (!buffer || !buffer.length) {
    return '';
  }

  if (kind === 'pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed?.text || '';
    } finally {
      await parser.destroy();
    }
  }

  if (kind === 'docx') {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed?.value || '';
  }

  if (kind === 'text') {
    return buffer.toString('utf8');
  }

  if (kind === 'html') {
    return decodeHtmlEntities(buffer.toString('utf8').replace(/<[^>]*>/g, '\n'));
  }

  return '';
};

const extractAttachments = async (auth, messageId, payload) => {
  const parts = collectAttachmentParts(payload);
  const attachments = [];
  const textBlocks = [];

  for (const part of parts) {
    const kind = attachmentKind(part.filename, part.mimeType);
    const item = {
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.size,
      kind,
      extracted: false,
      textLength: 0,
      error: '',
    };

    if (kind === 'unsupported') {
      attachments.push(item);
      continue;
    }

    try {
      const buffer = await attachmentDataBuffer(auth, messageId, part);
      const rawText = await extractAttachmentText(buffer, kind);
      const text = String(rawText || '')
        .replace(/\r/g, '')
        .replace(/\u200b/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, attachmentTextMaxChars);

      item.extracted = Boolean(text);
      item.textLength = text.length;
      if (text) {
        textBlocks.push(`\n\n[Attachment: ${part.filename}]\n${text}`);
      }
    } catch (error) {
      item.error = error.message || 'Attachment extraction failed';
    }

    attachments.push(item);
  }

  return {
    attachments,
    attachmentText: textBlocks.join('\n'),
  };
};

const escapeQueryTerm = (value = '') => {
  return String(value).replace(/[\"']/g, '\\$&');
};

const normalizeLookback = (value) => {
  const candidate = String(value || '').trim().toLowerCase();
  if (!candidate || candidate === '6m') {
    return '1y';
  }
  return /^\d+[dmy]$/.test(candidate) ? candidate : '1y';
};

const buildQuery = (trigger) => {
  const lookback = normalizeLookback(process.env.GMAIL_LOOKBACK);
  const fromPart = Array.isArray(trigger.senderEmails) && trigger.senderEmails.length
    ? `from:(${trigger.senderEmails.map((item) => `"${escapeQueryTerm(item)}"`).join(' OR ')})`
    : '';

  const keywordPart = Array.isArray(trigger.keywords) && trigger.keywords.length
    ? `(${trigger.keywords.map((item) => `"${escapeQueryTerm(item)}"`).join(' OR ')})`
    : '';

  const recent = `newer_than:${lookback}`;
  const constraints = [recent];

  if (fromPart) {
    constraints.push(fromPart);
  }
  if (keywordPart) {
    constraints.push(keywordPart);
  }

  return constraints.join(' ').trim();
};

export const fetchTriggerEmails = async (auth, trigger, maxResults = 50) => {
  const gmail = google.gmail({ version: 'v1', auth });
  const query = buildQuery(trigger);
  const totalLimit = Math.max(1, Number(maxResults) || 50);
  const items = [];
  let pageToken = undefined;

  do {
    const remaining = totalLimit - items.length;
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(500, remaining),
      pageToken,
    });

    items.push(...(data.messages || []));
    pageToken = data.nextPageToken;
  } while (pageToken && items.length < totalLimit);

  const resolved = [];

  for (const item of items) {
    const messageId = item.id;
    const msg = await getEmailDetail(auth, messageId);
    const headers = msg.payload?.headers || [];
    const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    const body = extractText(msg.payload);
    const attachmentResult = await extractAttachments(auth, messageId, msg.payload);

    resolved.push({
      id: messageId,
      threadId: msg.threadId,
      subject: getHeader('subject') || '(No Subject)',
      from: getHeader('from') || '(No From)',
      date: getHeader('date') || new Date().toISOString(),
      snippet: msg.snippet || '',
      body: `${body}${attachmentResult.attachmentText}`.trim(),
      bodyText: body,
      attachmentText: attachmentResult.attachmentText.trim(),
      attachments: attachmentResult.attachments,
    });
  }

  return resolved;
};

export const fetchCaseNumberEmails = async (auth, caseId, maxResults = 100) => {
  const gmail = google.gmail({ version: 'v1', auth });
  const lookback = normalizeLookback(process.env.GMAIL_LOOKBACK);
  const query = `newer_than:${lookback} "${escapeQueryTerm(caseId)}"`;
  const totalLimit = Math.max(1, Number(maxResults) || 100);
  const items = [];
  let pageToken = undefined;

  do {
    const remaining = totalLimit - items.length;
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(500, remaining),
      pageToken,
    });

    items.push(...(data.messages || []));
    pageToken = data.nextPageToken;
  } while (pageToken && items.length < totalLimit);

  const resolved = [];
  for (const item of items) {
    const messageId = item.id;
    const msg = await getEmailDetail(auth, messageId);
    const headers = msg.payload?.headers || [];
    const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    const body = extractText(msg.payload);
    const attachmentResult = await extractAttachments(auth, messageId, msg.payload);

    resolved.push({
      id: messageId,
      threadId: msg.threadId,
      subject: getHeader('subject') || '(No Subject)',
      from: getHeader('from') || '(No From)',
      date: getHeader('date') || new Date().toISOString(),
      snippet: msg.snippet || '',
      body: `${body}${attachmentResult.attachmentText}`.trim(),
      bodyText: body,
      attachmentText: attachmentResult.attachmentText.trim(),
      attachments: attachmentResult.attachments,
    });
  }

  return resolved;
};

export const fetchCaseFolderEmails = async (auth, searchTerms = [], maxResults = 100) => {
  const terms = [...new Set((Array.isArray(searchTerms) ? searchTerms : [])
    .map((item) => String(item || '').trim())
    .filter((item) => item.length >= 3))]
    .slice(0, 8);

  if (!terms.length) {
    return [];
  }

  const gmail = google.gmail({ version: 'v1', auth });
  const lookback = normalizeLookback(process.env.GMAIL_LOOKBACK);
  const queryTerms = terms.map((item) => `"${escapeQueryTerm(item)}"`).join(' OR ');
  const query = `newer_than:${lookback} (${queryTerms})`;
  const totalLimit = Math.max(1, Number(maxResults) || 100);
  const items = [];
  let pageToken = undefined;

  do {
    const remaining = totalLimit - items.length;
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(500, remaining),
      pageToken,
    });

    items.push(...(data.messages || []));
    pageToken = data.nextPageToken;
  } while (pageToken && items.length < totalLimit);

  const resolved = [];
  for (const item of items) {
    const messageId = item.id;
    const msg = await getEmailDetail(auth, messageId);
    const headers = msg.payload?.headers || [];
    const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    const body = extractText(msg.payload);
    const attachmentResult = await extractAttachments(auth, messageId, msg.payload);

    resolved.push({
      id: messageId,
      threadId: msg.threadId,
      subject: getHeader('subject') || '(No Subject)',
      from: getHeader('from') || '(No From)',
      date: getHeader('date') || new Date().toISOString(),
      snippet: msg.snippet || '',
      body: `${body}${attachmentResult.attachmentText}`.trim(),
      bodyText: body,
      attachmentText: attachmentResult.attachmentText.trim(),
      attachments: attachmentResult.attachments,
      matchedSearchTerms: terms,
    });
  }

  return resolved;
};
