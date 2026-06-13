import express from 'express';
import {
  getTriggers,
  addTrigger,
  updateTrigger,
  deleteTrigger,
  toggleTrigger,
} from '../lib/db.js';

const router = express.Router();

const validateTrigger = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return 'Invalid payload';
  }
  if (!payload.name || typeof payload.name !== 'string' || !payload.name.trim()) {
    return 'name is required';
  }
  const hasSender = Array.isArray(payload.senderEmails) && payload.senderEmails.length > 0;
  const hasKeyword = Array.isArray(payload.keywords) && payload.keywords.length > 0;
  if (!hasSender && !hasKeyword) {
    return 'At least one sender OR keyword is required';
  }
  return null;
};

router.get('/', async (_req, res) => {
  const triggers = await getTriggers();
  res.json({ triggers });
});

router.post('/', async (req, res) => {
  const error = validateTrigger(req.body || {});
  if (error) {
    return res.status(400).json({ error });
  }

  const payload = {
    name: String(req.body.name).trim(),
    senderEmails: (req.body.senderEmails || []).map((item) => String(item).trim()).filter(Boolean),
    keywords: (req.body.keywords || []).map((item) => String(item).trim()).filter(Boolean),
    caseIdPatterns: (req.body.caseIdPatterns || []).map((item) => String(item).trim()).filter(Boolean),
    calendarId: String(req.body.calendarId || process.env.SCAN_CALENDAR_ID || 'primary').trim() || 'primary',
    enabled: req.body.enabled !== false,
  };

  const next = await addTrigger(payload);
  res.json({ trigger: next });
});

router.put('/:id', async (req, res) => {
  const error = validateTrigger(req.body || {});
  if (error) {
    return res.status(400).json({ error });
  }

  const next = await updateTrigger(req.params.id, {
    name: String(req.body.name).trim(),
    senderEmails: (req.body.senderEmails || []).map((item) => String(item).trim()).filter(Boolean),
    keywords: (req.body.keywords || []).map((item) => String(item).trim()).filter(Boolean),
    caseIdPatterns: (req.body.caseIdPatterns || []).map((item) => String(item).trim()).filter(Boolean),
    calendarId: String(req.body.calendarId || process.env.SCAN_CALENDAR_ID || 'primary').trim() || 'primary',
    enabled: req.body.enabled !== false,
  });

  if (!next) {
    return res.status(404).json({ error: 'Trigger not found' });
  }

  res.json({ trigger: next });
});

router.delete('/:id', async (req, res) => {
  const ok = await deleteTrigger(req.params.id);
  if (!ok) {
    return res.status(404).json({ error: 'Trigger not found' });
  }
  res.json({ success: true });
});

router.patch('/:id/toggle', async (req, res) => {
  const next = await toggleTrigger(req.params.id);
  if (!next) {
    return res.status(404).json({ error: 'Trigger not found' });
  }
  res.json({ trigger: next });
});

export default router;
