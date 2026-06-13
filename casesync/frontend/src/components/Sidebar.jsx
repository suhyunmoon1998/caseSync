import { Bell, CalendarClock, Settings, ScanEye, X } from 'lucide-react';
import { useState } from 'react';
import caseSyncLogo from '../assets/casesync-logo.png';

const nav = [
  { key: 'dashboard', label: 'Dashboard', icon: ScanEye },
  { key: 'triggers', label: 'Triggers', icon: Settings },
  { key: 'calendar', label: 'Calendar', icon: CalendarClock },
  { key: 'cases', label: 'Cases', icon: CalendarClock },
];

const notificationStatus = (item) => {
  if (item.status === 'dismissed') {
    return 'Dismissed';
  }
  return item.type === 'updated_case' ? 'Updated' : 'New';
};

export default function Sidebar({
  page,
  setPage,
  accounts,
  notifications = [],
  pendingNotifications = 0,
  onClearNotifications,
  onDismissNotification,
}) {
  const [bellOpen, setBellOpen] = useState(false);
  const recent = notifications.slice(0, 20);

  return (
    <aside className="sidebar">
      <div className="brand-panel">
        <img className="brand-mark logo-image" src={caseSyncLogo} alt="CaseSync logo" />
        <div>
          <strong className="brand">CaseSync</strong>
          <div className="brand-sub">Legal Ops Dashboard</div>
        </div>
      </div>
      <div className="nav">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={`nav-item${page === item.key ? ' is-active' : ''}`}
              onClick={() => setPage(item.key)}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="notification-bell-wrap">
        <button className="notification-bell" type="button" onClick={() => setBellOpen((value) => !value)}>
          <Bell size={15} />
          <span>Notifications</span>
          {pendingNotifications > 0 ? <span className="notification-badge">{pendingNotifications}</span> : null}
        </button>
        {bellOpen ? (
          <div className="notification-panel">
            <div className="notification-panel-head">
              <strong>Recent alerts</strong>
              <button className="btn-icon" type="button" onClick={() => setBellOpen(false)}>
                <X size={14} />
              </button>
            </div>
            {recent.length === 0 ? (
              <div className="meta">No alerts yet</div>
            ) : (
              <div className="notification-list">
                {recent.map((item) => (
                  <div className={`notification-list-item${item.status === 'dismissed' ? ' is-dismissed' : ''}`} key={item.id}>
                    <div>
                      <div className="notification-list-title">
                        <strong>{item.caseId}</strong>
                        <span className="notification-list-status">{notificationStatus(item)}</span>
                      </div>
                      <div className="meta">{item.action}</div>
                      <div className="meta">Deadline: {item.deadline || 'n/a'}</div>
                    </div>
                    {item.status !== 'dismissed' ? (
                      <button className="btn-icon" type="button" onClick={() => onDismissNotification(item.id)}>
                        <X size={13} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {recent.length > 0 ? (
              <button className="btn-ghost" type="button" onClick={onClearNotifications}>
                Clear all
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="card account-bar">
        <h4>Connected accounts</h4>
        {accounts.length === 0 ? (
          <div className="meta">No connected accounts</div>
        ) : accounts.map((account) => (
          <div className="account-chip" key={account.email}>
            {account.name || account.email}
          </div>
        ))}
      </div>
    </aside>
  );
}
