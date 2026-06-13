import { UserCircle2 } from 'lucide-react';

export default function AccountBar({ accounts, onRemove, onConnect }) {
  return (
    <div className="card account-panel">
      <div className="account-panel__head">
        <div>
          <h3>Connected Gmail accounts</h3>
          <p className="meta">CaseSync scans every connected inbox during manual and scheduled scans.</p>
        </div>
        <span className="hint-chip">{accounts.length} connected</span>
      </div>
      {accounts.length === 0 ? <p className="meta">No Google accounts connected.</p> : null}
      {accounts.map((account) => (
        <div className="account-chip" key={account.email}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{account.name || account.email}</strong>
              <div className="meta">{account.email}</div>
            </div>
            <button className="btn-danger" onClick={() => onRemove(account.email)}>
              <UserCircle2 size={14} style={{ marginRight: 6 }} />
              Remove
            </button>
          </div>
        </div>
      ))}
      <button className="btn-primary" onClick={onConnect}>Add another Gmail account</button>
    </div>
  );
}
