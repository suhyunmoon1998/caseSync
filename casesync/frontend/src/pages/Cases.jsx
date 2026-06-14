import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import CaseCard from '../components/CaseCard';

const statusList = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'In progress' },
  { value: 'pending', label: 'Pending' },
  { value: 'closed', label: 'Closed' },
];

const caseColorPalette = [
  '#0071e3',
  '#34c759',
  '#ff9f0a',
  '#ff3b30',
  '#af52de',
  '#5e5ce6',
  '#00a7a7',
  '#bf5af2',
  '#ac8e68',
  '#ff6b35',
];

const randomCaseColor = () => caseColorPalette[Math.floor(Math.random() * caseColorPalette.length)];

export default function Cases({
  cases = [],
  onCreateCaseFolder,
  onStatusChange,
  onDelete,
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [expandedCaseId, setExpandedCaseId] = useState('');
  const [threshold, setThreshold] = useState(60);
  const [filterRowsBelowThreshold, setFilterRowsBelowThreshold] = useState(false);
  const [caseName, setCaseName] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [isCreatingCase, setIsCreatingCase] = useState(false);

  const isBelowThreshold = (caseItem) => {
    if (typeof caseItem.caseConfidence !== 'number') {
      return false;
    }
    return caseItem.caseConfidence < threshold;
  };

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return cases.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }

      if (q) {
        const text = `${item.caseId || ''} ${item.caseTitle || ''}`.toLowerCase();
        if (!text.includes(q)) {
          return false;
        }
      }

      if (filterRowsBelowThreshold && isBelowThreshold(item)) {
        return false;
      }

      return true;
    });
  }, [cases, statusFilter, searchText, threshold, filterRowsBelowThreshold]);

  const submitCaseFolder = async (event) => {
    event.preventDefault();
    const cleanNumber = caseNumber.trim();
    if (!cleanNumber || !onCreateCaseFolder) {
      return;
    }

    setIsCreatingCase(true);
    try {
      await onCreateCaseFolder({
        caseId: cleanNumber,
        caseTitle: caseName.trim() || cleanNumber,
        caseColor: randomCaseColor(),
      });
      setCaseName('');
      setCaseNumber('');
      setExpandedCaseId(cleanNumber);
    } finally {
      setIsCreatingCase(false);
    }
  };

  return (
    <div className="cases-page page-enter">
      <div className="topbar">
        <div>
          <h2>Cases</h2>
          <p className="meta">Review Proof of Service deadlines and AI-estimated case signals in one place.</p>
        </div>
        <div className="hint-chip">
          Showing: {filtered.length} / {cases.length}
        </div>
      </div>

      <form className="card quick-case-form" onSubmit={submitCaseFolder}>
        <div>
          <h3>Add case to workspace</h3>
          <p className="meta">Enter a case name and case number. CaseSync assigns a color and links matching emails after scans.</p>
        </div>
        <input
          className="input"
          value={caseName}
          onChange={(event) => setCaseName(event.target.value)}
          placeholder="Case name, e.g. Mun v. Apex"
        />
        <input
          className="input"
          value={caseNumber}
          onChange={(event) => setCaseNumber(event.target.value)}
          placeholder="Case number, e.g. 26STCV10888"
          required
        />
        <button className="btn-primary" type="submit" disabled={isCreatingCase || !caseNumber.trim()}>
          {isCreatingCase ? <span className="spinner" /> : <Plus size={14} />}
          {isCreatingCase ? 'Adding...' : 'Add case'}
        </button>
      </form>

      <div className="layout-grid two-col" style={{ marginBottom: 12 }}>
        <div className="card control-panel">
          <label className="meta" htmlFor="status-filter">
            Status
          </label>
          <select id="status-filter" className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {statusList.map((value) => (
              <option value={value.value} key={value.value}>
                {value.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card control-panel">
          <label className="meta" htmlFor="search">Search</label>
          <div className="search-input-wrap">
            <Search size={14} />
            <input
              id="search"
              className="input"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Case ID / title"
            />
          </div>
          <label className="meta toggle-row">
            <input
              type="checkbox"
              checked={filterRowsBelowThreshold}
              onChange={(event) => setFilterRowsBelowThreshold(event.target.checked)}
            />
            <span>Hide AI badges below the confidence threshold</span>
          </label>
        </div>
      </div>

      <div className="card control-panel" style={{ marginBottom: 12 }}>
        <label className="meta" htmlFor="confidence-threshold">
          AI estimate display threshold: <span className="hint-chip">{threshold}%</span>
        </label>
        <input
          id="confidence-threshold"
          type="range"
          min={0}
          max={100}
          value={threshold}
          onChange={(event) => setThreshold(Number(event.target.value))}
        />
        <p className="meta">
          Items below the threshold remain visible, but AI estimate badges are hidden.
        </p>
      </div>

      {cases.length === 0 ? (
        <section className="card empty-state">
          <h3>No cases yet</h3>
          <p className="meta">Create a trigger and run a scan to generate cases automatically.</p>
        </section>
      ) : filtered.length === 0 ? (
        <section className="card empty-state">
          <h3>No matching cases</h3>
          <p className="meta">Adjust the status, search term, or threshold and try again.</p>
        </section>
      ) : null}

      <div className="cases-grid">
        {filtered.map((item) => (
          <CaseCard
            key={`${item.caseId}-${item.id}`}
            caseItem={item}
            expanded={expandedCaseId === item.caseId}
            showEstimateAtOrAbove={threshold}
            onExpand={() => setExpandedCaseId(expandedCaseId === item.caseId ? '' : item.caseId)}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
          />
        ))}
      </div>

      {cases.some((item) => isBelowThreshold(item) && item.caseConfidence !== null) ? (
        <div className="meta">
          AI estimates below {threshold}% are simplified when the hide toggle is on.
        </div>
      ) : null}
    </div>
  );
}
