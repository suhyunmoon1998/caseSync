import { useEffect, useMemo, useRef, useState } from 'react';
import AccountBar from './components/AccountBar';
import NotificationManager from './components/NotificationManager';
import Dashboard from './pages/Dashboard';
import Triggers from './pages/Triggers';
import Cases from './pages/Cases';
import Calendar from './pages/Calendar';
import caseSyncLogo from './assets/casesync-logo.png';
import {
  getAccounts,
  removeAccount,
  loginWithGoogle,
  getCases,
  getScanLogs,
  getScanStatus,
  getLastScanResult,
  runScan,
  updateCaseStatus,
  deleteCase,
  confirmCase,
} from './utils/api';

const DEFAULT_SCAN_POLL_MS = 5 * 60 * 1000;

const toastForError = (error) => {
  if (!error) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error.response?.data?.error) {
    return error.response.data.error;
  }
  if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
    return 'Unable to reach CaseSync server. Please refresh or try again in a moment.';
  }
  return error.message || 'Request failed. Please try again.';
};

const notificationId = (item) => [
  item.type || 'case',
  item.caseId || 'unknown',
  item.deadline || 'no-date',
  item.createdAt || '',
].join('|');

const normalizeNotifications = (items = []) => {
  return (items || []).map((item) => ({
    ...item,
    id: notificationId(item),
    status: 'pending',
  }));
};

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [cases, setCases] = useState([]);
  const [scanLogs, setScanLogs] = useState([]);
  const [scanStatus, setScanStatus] = useState({});
  const [caseNotifications, setCaseNotifications] = useState([]);
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [activeView, setActiveView] = useState('cases');
  const [isLoading, setIsLoading] = useState({ accounts: true, cases: false, logs: false, scan: false });
  const lastNotifiedScanRef = useRef('');
  const scanStatusInitializedRef = useRef(false);

  const mergeNotifications = (items = []) => {
    const incoming = normalizeNotifications(items);
    if (!incoming.length) {
      return;
    }

    setCaseNotifications((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      for (const item of incoming) {
        byId.set(item.id, {
          ...byId.get(item.id),
          ...item,
          status: byId.get(item.id)?.status || item.status,
        });
      }

      const next = [...byId.values()]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, 20);
      const pending = next.filter((item) => item.status !== 'dismissed');
      const overflow = new Set(pending.slice(5).map((item) => item.id));

      return next.map((item) => (
        overflow.has(item.id)
          ? { ...item, status: 'dismissed' }
          : item
      ));
    });
  };

  const dismissNotification = (id) => {
    setCaseNotifications((prev) => prev.map((item) => (
      item.id === id ? { ...item, status: 'dismissed' } : item
    )));
  };

  const clearNotifications = () => {
    setCaseNotifications((prev) => prev.map((item) => ({ ...item, status: 'dismissed' })));
  };

  const confirmNotification = async (item) => {
    try {
      await confirmCase(item.caseId);
      dismissNotification(item.id);
      await loadCases();
      setToast('Added to CaseSync Calendar.');
    } catch (error) {
      setToast(toastForError(error));
    }
  };

  const loadAccounts = async () => {
    setIsLoading((prev) => ({ ...prev, accounts: true }));
    try {
      const list = await getAccounts();
      setAccounts(list);
    } catch (error) {
      setToast(toastForError(error));
    } finally {
      setIsLoading((prev) => ({ ...prev, accounts: false }));
    }
  };

  const loadScanStatus = async () => {
    try {
      const next = await getScanStatus();
      setScanStatus(next);
      if (!scanStatusInitializedRef.current) {
        lastNotifiedScanRef.current = next.lastScan || '';
        scanStatusInitializedRef.current = true;
        return;
      }

      if (next.lastScan && next.lastScan !== lastNotifiedScanRef.current) {
        const result = await getLastScanResult();
        mergeNotifications(result?.notifications || []);
        lastNotifiedScanRef.current = next.lastScan;
      }
    } catch (error) {
      setToast(toastForError(error));
    }
  };

  const loadCases = async () => {
    setIsLoading((prev) => ({ ...prev, cases: true }));
    try {
      const list = await getCases();
      setCases(list);
    } catch (error) {
      setToast(toastForError(error));
    } finally {
      setIsLoading((prev) => ({ ...prev, cases: false }));
    }
  };

  const loadLogs = async () => {
    setIsLoading((prev) => ({ ...prev, logs: true }));
    try {
      const logs = await getScanLogs();
      setScanLogs(logs);
    } catch (error) {
      setToast(toastForError(error));
    } finally {
      setIsLoading((prev) => ({ ...prev, logs: false }));
    }
  };

  const loadAll = async () => {
    await Promise.all([
      loadCases(),
      loadLogs(),
      loadScanStatus(),
      loadAccounts(),
    ]);
  };

  useEffect(() => {
    const connected = new URLSearchParams(window.location.search).get('connected');
    if (connected === 'true') {
      setToast('Google account connected.');
      window.history.replaceState({}, '', '/');
    }
    void loadAll();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      void loadScanStatus();
    }, DEFAULT_SCAN_POLL_MS);

    return () => {
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const id = setTimeout(() => {
      setToast('');
    }, 4000);

    return () => clearTimeout(id);
  }, [toast]);

  const onConnect = () => {
    loginWithGoogle();
  };

  const onRemoveAccount = async (email) => {
    try {
      await removeAccount(email);
      await loadAccounts();
      await loadCases();
      setToast('Account removed');
    } catch (error) {
      setToast(toastForError(error));
    }
  };

  const onRunScan = async () => {
    setIsLoading((prev) => ({ ...prev, scan: true }));
    try {
      const result = await runScan();
      mergeNotifications(result?.result?.notifications || []);
      await loadAll();
      setToast('Scan completed');
    } catch (error) {
      setToast(toastForError(error));
    } finally {
      setIsLoading((prev) => ({ ...prev, scan: false }));
    }
  };

  const onUpdateCaseStatus = async (caseId, status) => {
    try {
      await updateCaseStatus(caseId, status);
      await loadCases();
      setToast('Case status updated');
    } catch (error) {
      setToast(toastForError(error));
    }
  };

  const onDeleteCase = async (caseId) => {
    if (!window.confirm(`Delete case ${caseId}?`)) {
      return;
    }

    try {
      await deleteCase(caseId);
      await loadCases();
      setToast('Case deleted');
    } catch (error) {
      setToast(toastForError(error));
    }
  };

  const onTriggerSaved = async () => {
    await loadCases();
    await loadLogs();
    await loadScanStatus();
  };

  const dashboardProps = {
    cases,
    scanStatus,
    scanLogs,
    onRunScan,
    loadingScan: isLoading.scan,
  };

  const casesProps = {
    cases,
    onStatusChange: onUpdateCaseStatus,
    onDelete: onDeleteCase,
  };

  const main = useMemo(() => {
    const navItems = [
      {
        key: 'cases',
        label: 'Cases',
        kicker: `${cases.length} tracked`,
        title: 'Cases',
        description: 'Review active response deadlines, confidence, status, and case details.',
      },
      {
        key: 'dashboard',
        label: 'Dashboard',
        kicker: 'Overview',
        title: 'Dashboard',
        description: 'Scan status, deadline health, and recent activity at a glance.',
      },
      {
        key: 'calendar',
        label: 'Calendar',
        kicker: 'Schedule',
        title: 'Calendar',
        description: 'Plan deadlines by range and right-click any date to add a schedule.',
      },
      {
        key: 'triggers',
        label: 'Triggers',
        kicker: 'Automation',
        title: 'Triggers',
        description: 'Control the Gmail rules that detect discovery deadlines.',
      },
    ];
    const current = navItems.find((item) => item.key === activeView) || navItems[0];

    const view = {
      cases: <Cases {...casesProps} />,
      dashboard: <Dashboard {...dashboardProps} />,
      calendar: <Calendar cases={cases} accounts={accounts} onManualCaseCreated={loadAll} />,
      triggers: <Triggers accounts={accounts} onSaved={onTriggerSaved} />,
    }[current.key];

    return (
      <div className="canvas-workspace">
        <aside className="canvas-sidebar" aria-label="CaseSync sections">
          <div className="canvas-sidebar-title">
            <span>Workspace</span>
            <strong>CaseSync</strong>
          </div>
          <div className="canvas-nav">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={`canvas-nav-item${item.key === current.key ? ' is-active' : ''}`}
                type="button"
                onClick={() => setActiveView(item.key)}
              >
                <span>{item.label}</span>
                <small>{item.kicker}</small>
              </button>
            ))}
          </div>
          <div className="canvas-sidebar-footer">
            <div className="connected-pill">
              {accounts.length} Google {accounts.length === 1 ? 'account' : 'accounts'} connected
            </div>
            <button className="btn-primary" onClick={onRunScan} disabled={isLoading.scan}>
              {isLoading.scan ? <span className="spinner" /> : null}
              {isLoading.scan ? 'Scanning...' : 'Scan now'}
            </button>
          </div>
        </aside>

        <section className="canvas-stage">
          <div className="canvas-stage-head">
            <div>
              <p className="eyebrow">Legal email automation</p>
              <h1>{current.title}</h1>
              <p className="hero-copy">{current.description}</p>
            </div>
            <div className="hero-actions">
              <button className="btn-ghost" type="button" onClick={onConnect}>
                Add Gmail
              </button>
              <button className="btn-primary" onClick={onRunScan} disabled={isLoading.scan}>
                {isLoading.scan ? <span className="spinner" /> : null}
                {isLoading.scan ? 'Scanning...' : 'Scan now'}
              </button>
            </div>
          </div>
          <div className="canvas-view">
            {view}
          </div>
        </section>
      </div>
    );
  }, [activeView, cases, scanLogs, scanStatus, accounts, isLoading.scan, casesProps]);

  const pendingNotifications = caseNotifications.filter((item) => item.status !== 'dismissed').length;
  const recentNotifications = caseNotifications.slice(0, 20);

  if (isLoading.accounts && accounts.length === 0) {
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <img className="connect-icon logo-image" src={caseSyncLogo} alt="CaseSync logo" />
          <h1>Loading CaseSync</h1>
          <p className="meta">Preparing your legal ops dashboard.</p>
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <img className="connect-icon logo-image" src={caseSyncLogo} alt="CaseSync logo" />
          <p className="eyebrow">Welcome to CaseSync</p>
          <h1 className="landing-headline">Automatically track court deadlines from email.</h1>
          <p className="connect-copy">
            Connect Google once. CaseSync reads matching Gmail messages and writes case deadlines to Google Calendar.
          </p>
          <button className="btn-primary connect-cta" onClick={onConnect}>
            Connect Google Account
          </button>
          <p className="meta">Requires Gmail read access and Google Calendar write access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell app-shell-clean">
      <header className="clean-header">
        <div className="clean-brand">
          <img className="brand-mark logo-image" src={caseSyncLogo} alt="CaseSync logo" />
          <div>
            <strong>CaseSync</strong>
            <span>Everything important on one screen</span>
          </div>
        </div>

        <div className="clean-header-actions">
          <div className="notification-bell-wrap">
            <button
              className="notification-bell header-bell"
              type="button"
              onClick={() => setNotifPanelOpen((value) => !value)}
            >
              <span>Notifications</span>
              {pendingNotifications > 0 ? <span className="notification-badge">{pendingNotifications}</span> : null}
            </button>
            {notifPanelOpen ? (
              <div className="notification-panel header-notification-panel">
                <div className="notification-panel-head">
                  <strong>Recent alerts</strong>
                  {recentNotifications.length > 0 ? (
                    <button className="btn-ghost" type="button" onClick={clearNotifications}>
                      Dismiss all
                    </button>
                  ) : null}
                </div>
                {recentNotifications.length === 0 ? (
                  <div className="meta">No alerts yet</div>
                ) : (
                  <div className="notification-list">
                    {recentNotifications.map((item) => (
                      <div className={`notification-list-item${item.status === 'dismissed' ? ' is-dismissed' : ''}`} key={item.id}>
                        <div>
                          <div className="notification-list-title">
                            <strong>{item.caseId}</strong>
                            <span className="notification-list-status">
                              {item.type === 'updated_case' ? 'Updated' : 'New'}
                            </span>
                          </div>
                          <div className="meta">{item.action}</div>
                          <div className="meta">Deadline: {item.deadline || 'n/a'}</div>
                        </div>
                        {item.status !== 'dismissed' ? (
                          <button className="btn-icon" type="button" onClick={() => dismissNotification(item.id)}>
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <span className="account-pill">
            {accounts.length === 1 ? accounts[0]?.email : `${accounts.length} inboxes`}
          </span>
          <button className="btn-ghost" type="button" onClick={onConnect}>
            Add Gmail
          </button>
          <button className="btn-primary" onClick={onRunScan} disabled={isLoading.scan}>
            {isLoading.scan ? <span className="spinner" /> : null}
            {isLoading.scan ? 'Scanning...' : 'Scan now'}
          </button>
        </div>
      </header>

      <main className="main main-clean">
        {main}
        <AccountBar
          accounts={accounts}
          onConnect={onConnect}
          onRemove={onRemoveAccount}
        />
      </main>
      <NotificationManager
        notifications={caseNotifications}
        onConfirm={confirmNotification}
        onDismiss={dismissNotification}
      />
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
