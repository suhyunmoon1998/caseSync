import { BellRing, CalendarPlus, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import caseSyncLogo from '../assets/casesync-logo.png';

const titleFor = (item) => (item.type === 'updated_case' ? 'Case updated' : 'New case found');
const ActionIcon = ({ type }) => (type === 'updated_case' ? <RotateCw size={14} /> : <CalendarPlus size={14} />);

export default function NotificationManager({
  notifications = [],
  onConfirm,
  onDismiss,
}) {
  const [permission, setPermission] = useState(() => (
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
  ));
  const notifiedRef = useRef(new Set());
  const visible = notifications.filter((item) => item.status !== 'dismissed').slice(0, 5);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }

    if (window.Notification.permission === 'default') {
      window.Notification.requestPermission().then(setPermission).catch(() => setPermission(window.Notification.permission));
      return;
    }

    setPermission(window.Notification.permission);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || permission !== 'granted') {
      return;
    }

    for (const item of visible) {
      if (notifiedRef.current.has(item.id)) {
        continue;
      }

      notifiedRef.current.add(item.id);
      const body = `[${item.caseId}] ${item.action}\nDeadline: ${item.deadline || 'n/a'}${Number.isFinite(item.daysUntil) ? ` (${item.daysUntil} days)` : ''}`;
      const note = new window.Notification(titleFor(item), {
        body,
        icon: caseSyncLogo,
        tag: item.caseId,
        requireInteraction: Number(item.daysUntil) <= 7,
      });
      note.onclick = () => {
        window.focus();
      };
    }
  }, [permission, visible]);

  if (!visible.length) {
    return null;
  }

  return (
    <div className="notif-stack" aria-live="polite">
      {visible.map((item) => {
        const urgent = Number(item.daysUntil) <= 3;
        const updated = item.type === 'updated_case';

        return (
          <div
            key={item.id}
            className={`notif-toast${urgent ? ' urgent' : ''}${updated ? ' updated' : ''}`}
          >
            <div className="notif-toast-title">
              <BellRing size={14} />
              <span>{titleFor(item)}</span>
            </div>
            <div className="notif-toast-body">
              <strong>[{item.caseId}]</strong> {item.action}
            </div>
            <div className={`notif-toast-deadline${urgent ? ' urgent' : ''}`}>
              {urgent ? <span className="pulse-dot" /> : null}
              Deadline: {item.deadline || 'n/a'}
              {Number.isFinite(item.daysUntil) ? ` (${item.daysUntil} days)` : ''}
            </div>
            <div className="notif-toast-actions">
              <button className="btn-primary" type="button" onClick={() => onConfirm(item)}>
                <ActionIcon type={item.type} />
                {updated ? 'Add to CaseSync Calendar' : 'Add to CaseSync Calendar'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => onDismiss(item.id)}>
                <X size={14} />
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
