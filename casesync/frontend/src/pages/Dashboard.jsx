import { useMemo } from 'react';
import { differenceInCalendarDays, formatDistanceToNow } from 'date-fns';
import { Activity, AlertTriangle, CalendarClock, Clock, FolderOpen, RefreshCw, TimerReset } from 'lucide-react';
import ScanLog from '../components/ScanLog';

export default function Dashboard({
  cases = [],
  scanStatus = {},
  scanLogs = [],
  loadingScan = false,
  onRunScan,
}) {
  const stats = useMemo(() => {
    const now = new Date();
    const total = cases.length;
    const active = cases.filter((item) => item.status === 'active').length;
    const pendingWeek = cases.filter((item) => {
      if (!item.nextDeadline?.date) {
        return false;
      }
      const left = differenceInCalendarDays(new Date(`${item.nextDeadline.date}T00:00:00`), now);
      return left >= 0 && left <= 14;
    }).length;
    const pendingMonth = cases.filter((item) => {
      if (!item.nextDeadline?.date) {
        return false;
      }
      const left = differenceInCalendarDays(new Date(`${item.nextDeadline.date}T00:00:00`), now);
      return left >= 0 && left <= 60;
    }).length;
    const overdue = cases.filter((item) => {
      if (!item.nextDeadline?.date) {
        return false;
      }
      const left = differenceInCalendarDays(new Date(`${item.nextDeadline.date}T00:00:00`), now);
      return left < 0;
    }).length;

    return {
      total,
      active,
      pendingWeek,
      pendingMonth,
      overdue,
    };
  }, [cases]);

  const upcoming = useMemo(() => {
    const now = new Date();
    return cases
      .filter((item) => item.nextDeadline?.date)
      .map((item) => ({
        ...item,
        diff: differenceInCalendarDays(new Date(`${item.nextDeadline.date}T00:00:00`), now),
      }))
      .filter((item) => item.diff >= 0 && item.diff <= 60)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 10);
  }, [cases]);

  const nextScanText = scanStatus.nextScan
    ? formatDistanceToNow(new Date(scanStatus.nextScan), { addSuffix: true })
    : 'Not scheduled';
  const lastScanText = scanStatus.lastScan
    ? new Date(scanStatus.lastScan).toLocaleDateString()
    : 'Never run';

  return (
    <div className="page-enter">
      <div className="topbar">
        <div>
          <h2>Today</h2>
          <p className="meta">Start here. CaseSync shows what needs attention and what can wait.</p>
        </div>
        <button className="btn-primary" onClick={onRunScan} disabled={loadingScan}>
          <RefreshCw size={15} />
          {loadingScan ? 'Checking inboxes...' : 'Check inboxes now'}
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-icon"><FolderOpen size={16} /></div>
          <div className="n">{stats.total}</div>
          <div>Tracked cases</div>
        </div>
        <div className="stat">
          <div className="stat-icon stat-icon-danger"><AlertTriangle size={16} /></div>
          <div className="n">{stats.overdue}</div>
          <div>Overdue</div>
        </div>
        <div className="stat">
          <div className="stat-icon stat-icon-success"><Activity size={16} /></div>
          <div className="n">{stats.active}</div>
          <div>In progress</div>
        </div>
        <div className="stat">
          <div className="stat-icon stat-icon-warning"><TimerReset size={16} /></div>
          <div className="n">{stats.pendingWeek}</div>
          <div>Due within 14 days</div>
        </div>
        <div className="stat">
          <div className="stat-icon"><CalendarClock size={16} /></div>
          <div className="n">{stats.pendingMonth}</div>
          <div>Due within 60 days</div>
        </div>
        <div className="stat">
          <div className="stat-icon"><Clock size={16} /></div>
          <div className="n">{lastScanText}</div>
          <div>Last scan</div>
        </div>
        <div className="stat">
          <div className="stat-icon"><CalendarClock size={16} /></div>
          <div className="n">{nextScanText}</div>
          <div>Next automatic check</div>
        </div>
      </div>

      <div className="layout-grid two-col" style={{ marginBottom: 12 }}>
        <div className="card">
          <h3>Deadlines coming up</h3>
          {upcoming.length === 0 ? <div className="meta">Nothing urgent found. CaseSync will keep watching connected inboxes.</div> : (
            <div className="timeline">
              {upcoming.map((item) => {
                const dayText = item.diff === 0 ? 'Today' : `${item.diff} days`;
                const bucket = item.diff <= 3 ? 'high' : (item.diff <= 14 ? 'medium' : 'low');
                return (
                  <div className="timeline-item" key={`${item.caseId}-${item.nextDeadline?.date}`}>
                    <div>
                      <strong>{item.caseId || '(No case ID)'}</strong> — {item.caseTitle}
                    </div>
                    <div className="timeline-meta">
                      <span className="meta">{item.nextDeadline?.date} ({dayText})</span>
                      <span className={`badge badge-${bucket}`}>{bucket === 'high' ? 'Urgent' : bucket === 'medium' ? 'Due soon' : 'On track'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <ScanLog logs={scanLogs} />
      </div>
    </div>
  );
}
