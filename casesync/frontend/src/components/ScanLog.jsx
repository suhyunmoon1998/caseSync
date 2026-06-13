import { AlertTriangle } from 'lucide-react';

const formatScanTime = (value) => {
  if (!value) {
    return 'n/a';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, '0');
  const suffix = date.getHours() >= 12 ? 'p' : 'a';

  return `${month}/${day} ${hour}:${minute}${suffix}`;
};

export default function ScanLog({ logs = [] }) {
  if (!logs.length) {
    return <div className="meta">No scan logs yet.</div>;
  }

  const entries = logs.slice(0, 20);

  return (
    <div className="card">
      <h3>Recent scan logs</h3>
      <div className="scan-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Mode</th>
              <th>Emails</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((item) => {
              const hasError = (item.errors || []).length > 0;
              return (
                <tr key={item.id} className={hasError ? 'scan-row-error' : undefined}>
                  <td>{formatScanTime(item.finishedAt || item.startedAt)}</td>
                  <td>{item.trigger}</td>
                  <td>{item.emailsScanned}</td>
                  <td>{item.casesCreated}</td>
                  <td>{item.casesUpdated}</td>
                  <td>
                    {hasError ? (
                      <span className="scan-error-count">
                        <AlertTriangle size={14} />
                        {item.errors.length}
                      </span>
                    ) : '0'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {entries.some((item) => (item.errors || []).length > 0) ? <div className="meta scan-log-note">Some scans reported errors. Open server logs for details.</div> : null}
    </div>
  );
}
