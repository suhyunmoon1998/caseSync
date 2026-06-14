import express from 'express';
import {
  getCaseRecords,
  updateCaseById,
  deleteCaseById,
  importCalendarCasesToDb,
  createManualCase,
  createCaseFolder,
} from '../lib/scanner.js';
import {
  getCaseEmailRecords,
  updateCaseEmailRecord,
} from '../lib/db.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const cases = await getCaseRecords();
    res.json({ cases });
  } catch (error) {
    console.error('Get cases failed', error);
    res.status(500).json({ error: 'Failed to load cases' });
  }
});

router.post('/import-calendar', async (_req, res) => {
  try {
    const result = await importCalendarCasesToDb();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Import calendar cases failed', error);
    res.status(500).json({ error: 'Failed to import calendar cases' });
  }
});

router.post('/manual', async (req, res) => {
  try {
    const result = await createManualCase(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Create manual case failed', error);
    res.status(400).json({ error: error.message || 'Failed to create manual calendar entry' });
  }
});

router.post('/folder', async (req, res) => {
  try {
    const result = await createCaseFolder(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Create case folder failed', error);
    res.status(400).json({ error: error.message || 'Failed to create case folder' });
  }
});

router.get('/:caseId/emails', async (req, res) => {
  try {
    const caseId = decodeURIComponent(req.params.caseId || '').trim();
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
    const emails = await getCaseEmailRecords(caseId, limit);
    res.json({ emails });
  } catch (error) {
    console.error('Get case emails failed', error);
    res.status(500).json({ error: 'Failed to load case emails' });
  }
});

router.patch('/:caseId/emails/:messageId', async (req, res) => {
  try {
    const currentCaseId = decodeURIComponent(req.params.caseId || '').trim();
    const messageId = decodeURIComponent(req.params.messageId || '').trim();
    const nextCaseId = String(req.body?.caseId || currentCaseId).trim();
    if (!nextCaseId) {
      return res.status(400).json({ error: 'Case ID is required' });
    }

    const email = await updateCaseEmailRecord(messageId, {
      caseId: nextCaseId,
      needsReview: req.body?.needsReview,
      classification: req.body?.classification,
      sourceReason: req.body?.sourceReason,
    });

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.json({ success: true, email });
  } catch (error) {
    console.error('Update case email failed', error);
    res.status(500).json({ error: 'Failed to update case email' });
  }
});

router.get('/:caseId', async (req, res) => {
  try {
    const caseId = decodeURIComponent(req.params.caseId || '').trim();
    const cases = await getCaseRecords();
    const found = cases.find((item) => item.caseId === caseId);
    if (!found) {
      return res.status(404).json({ error: 'Case not found' });
    }
    res.json({ case: found });
  } catch (error) {
    console.error('Get case failed', error);
    res.status(500).json({ error: 'Failed to load case' });
  }
});

router.post('/:caseId/confirm', async (req, res) => {
  try {
    const caseId = decodeURIComponent(req.params.caseId || '').trim();
    const cases = await getCaseRecords();
    const found = cases.find((item) => item.caseId === caseId);
    if (!found) {
      return res.status(404).json({ error: 'Case not found' });
    }
    res.json({ success: true, calendarEventUrl: found.htmlLink || '' });
  } catch (error) {
    console.error('Confirm case failed', error);
    res.status(500).json({ error: 'Failed to confirm case' });
  }
});

router.patch('/:caseId/status', async (req, res) => {
  try {
    const caseId = decodeURIComponent(req.params.caseId || '').trim();
    const status = String(req.body?.status || 'active');
    if (!['active', 'pending', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await updateCaseById(caseId, status);
    if (!result) {
      return res.status(404).json({ error: 'Case not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Update case status failed', error);
    res.status(500).json({ error: 'Failed to update case status' });
  }
});

router.delete('/:caseId', async (req, res) => {
  try {
    const caseId = decodeURIComponent(req.params.caseId || '').trim();
    const result = await deleteCaseById(caseId);
    if (!result) {
      return res.status(404).json({ error: 'Case not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete case failed', error);
    res.status(500).json({ error: 'Failed to delete case' });
  }
});

export default router;
