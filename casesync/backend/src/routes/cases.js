import express from 'express';
import {
  getCaseRecords,
  updateCaseById,
  deleteCaseById,
  importCalendarCasesToDb,
} from '../lib/scanner.js';

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
