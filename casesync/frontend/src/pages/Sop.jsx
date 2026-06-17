import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  FolderKanban,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

const reviewSources = [
  'Court notices and e-filing notifications',
  'Opposing counsel service emails',
  'Vendor deadlines, invoices, payments, renewals, and uploads',
];

const missedTriggerTypes = [
  'Discovery served',
  'Court notices',
  'Hearing notices',
  'CMC notices',
  'Vendor deadlines and payments',
];

const sopItems = [
  {
    phase: 'Intake / sign-up',
    trigger: 'Signed retainer, new lead converted, or matter opened.',
    rule: 'Open case project immediately; confirm client/contact/court information before any deadline work.',
    calendar: 'Initial client follow-up; intake document collection; internal case setup due date.',
    templates: 'Intake checklist, client welcome email, authorization packet.',
    owner: 'Intake / assigned paralegal',
    ticklers: '24-hour setup review; 7-day missing-documents follow-up.',
  },
  {
    phase: 'Case setup',
    trigger: 'Case number, court, parties, or opposing counsel identified.',
    rule: 'Create CaseSync case folder and attach matching Gmail history.',
    calendar: 'Case audit date; insurance/records/document request follow-ups.',
    templates: 'Case opening memo, contact sheet, litigation plan.',
    owner: 'Assigned case manager',
    ticklers: 'Weekly until all core fields and contacts are complete.',
  },
  {
    phase: 'Filing',
    trigger: 'Complaint, petition, answer, cross-complaint, motion, or filing task created.',
    rule: 'Calendar filing due date, rejection review, and service follow-up.',
    calendar: 'Filing deadline; filing confirmation check; rejection correction tickler.',
    templates: 'Pleading shell, filing checklist, proof of service shell.',
    owner: 'Attorney + filing clerk',
    ticklers: 'Same-day filing confirmation; next-business-day rejection audit.',
  },
  {
    phase: 'Service',
    trigger: 'Summons/complaint, pleading, discovery, motion, or notice served/received.',
    rule: 'Use proof of service date and service method; calculate response/appearance deadline.',
    calendar: 'Response deadline; two-week tickler; one-week tickler; proof follow-up.',
    templates: 'POS review checklist, service instruction email, response deadline memo.',
    owner: 'Paralegal',
    ticklers: 'Confirm service package and method within 24 hours.',
  },
  {
    phase: 'Discovery',
    trigger: 'FROGs, SROGs, RFPs, RFAs, subpoenas, deposition notices, or discovery responses served.',
    rule: 'Written discovery responses are 30 days from service, plus service extension where applicable.',
    calendar: 'Response deadline; 2-week tickler; 1-week tickler; first-week client call.',
    templates: 'Discovery response skeletons, verification, client questions, document request list.',
    owner: 'Discovery paralegal + attorney',
    ticklers: 'Client call in first week; attorney review before service.',
  },
  {
    phase: 'Hearings',
    trigger: 'Court notice, reservation confirmation, motion filing, or hearing continuance.',
    rule: 'Calendar hearing and all briefing/notice/local-rule dates after attorney review.',
    calendar: 'Hearing; opposition/reply deadlines; preparation deadline; filing/service checks.',
    templates: 'Hearing prep checklist, notice of ruling shell, motion/opposition/reply shells.',
    owner: 'Attorney + calendar clerk',
    ticklers: '30/14/7/2-day prep checks depending on hearing type.',
  },
  {
    phase: 'Mediation',
    trigger: 'Mediation date, ADR order, mediator email, or settlement conference notice.',
    rule: 'Calendar mediation, brief deadline, document exchange, client prep, and authority call.',
    calendar: 'Mediation; brief due; exhibits due; client prep call; authority confirmation.',
    templates: 'Mediation brief shell, demand package checklist, authority memo.',
    owner: 'Attorney + case manager',
    ticklers: '45/30/14/7-day preparation milestones.',
  },
  {
    phase: 'Trial / arbitration',
    trigger: 'Trial setting order, FSC/MSC notice, arbitration date, or trial continuance.',
    rule: 'Build trial calendar from court order and local rules; attorney review required.',
    calendar: 'Trial; FSC/MSC; motions in limine; exhibit/witness deadlines; subpoenas.',
    templates: 'Trial checklist, witness list, exhibit list, MIL shells, subpoena packet.',
    owner: 'Trial attorney + trial paralegal',
    ticklers: '90/60/45/30/14/7-day trial readiness checks.',
  },
  {
    phase: 'Settlement / dismissal',
    trigger: 'Settlement reached, release circulated, payment due, dismissal deadline, or lien issue.',
    rule: 'Track payment, release, lien resolution, dismissal, and closing package.',
    calendar: 'Payment deadline; release due; lien follow-up; dismissal filing; closing letter.',
    templates: 'Settlement checklist, release review, dismissal shell, closing letter.',
    owner: 'Settlement desk + attorney',
    ticklers: 'Weekly until funds, release, liens, and dismissal are complete.',
  },
  {
    phase: 'Default / judgment / collection',
    trigger: 'No response, default eligibility, judgment entered, or payment plan missed.',
    rule: 'Calendar default/judgment/collection steps after attorney review.',
    calendar: 'Default package due; prove-up; judgment follow-up; collection review.',
    templates: 'Default checklist, prove-up packet, judgment memo, collection checklist.',
    owner: 'Attorney + collections clerk',
    ticklers: '10/30/60-day post-judgment and payment compliance checks.',
  },
];

const writtenDiscoverySteps = [
  'Determine Proof of Service date from the proof, not the email received date.',
  'Determine service method: personal = 30 days, electronic = 32 days, mail = 35 days where applicable.',
  'Calendar last day to serve verified responses.',
  'Calendar two-week and one-week ticklers.',
  'Calendar client call within the first week for answers, documents, and verification.',
  'Generate skeleton responses for FROGs, SROGs, RFPs, and RFAs.',
  'Add trigger, calendar entries, and related emails to the correct case project.',
];

const cmcSteps = [
  'Calendar the CMC hearing date from the court notice.',
  'Calendar CMC statement deadline: 15 calendar days before the CMC, unless court/local order says otherwise.',
  'Calendar meet-and-confer target: 30 calendar days before the initial CMC, unless ordered otherwise.',
  'Calendar internal attorney review and filing/service ticklers.',
  'Generate CMC statement template and meet-and-confer letter shell.',
  'Attach the court notice and AI/parser extraction result to the correct case project.',
];

const migrationTasks = [
  'Migrate Giselle Gmail into Google Drive and/or CaseSync searchable project knowledge.',
  'After confirming migration, shut down the standalone Giselle email account to stop the monthly fee.',
  'Migrate SugarSync data to the migration computer, then into Google Drive.',
  'After confirming SugarSync migration, cancel SugarSync.',
  'Move Google Classroom video transcripts from thumb drive into Google Drive and project knowledge where useful.',
  'Go through thumb drives and old drives, including Diana old computer.',
  'Prioritize accessibility over duplicate cleanup; organize searchable folders first.',
];

export default function Sop({
  accounts = [],
  cases = [],
  scanLogs = [],
  loadingScan = false,
  onRunScan,
  onOpenTriggers,
  onOpenCalendar,
}) {
  const accountNames = accounts.map((account) => account.email).filter(Boolean);
  const latestScan = scanLogs[0];
  const activeCases = cases.filter((item) => item.status !== 'closed').length;

  return (
    <div className="sop-page page-enter">
      <div className="topbar">
        <div>
          <h2>SOP & Missed Trigger Review</h2>
          <p className="meta">A working command center for the 90-day SOP goal: detect missed triggers, calendar them, and build repeatable rules.</p>
        </div>
        <div className="trigger-top-actions">
          <button className="btn-ghost" type="button" onClick={onOpenTriggers}>
            <FileSearch size={14} /> Edit email rules
          </button>
          <button className="btn-primary" type="button" onClick={onRunScan} disabled={loadingScan}>
            {loadingScan ? <span className="spinner" /> : <RefreshCw size={14} />}
            {loadingScan ? 'Reviewing...' : 'Run missed-trigger scan'}
          </button>
        </div>
      </div>

      <section className="sop-hero card">
        <div>
          <span className="eyebrow">Immediate priority</span>
          <h3>Review the last 30-60 days for anything that should already be on calendar.</h3>
          <p className="meta">
            Check both Gmail sources, then use Email Rules for automation and Calendar for any manual entry that needs to be corrected today.
          </p>
        </div>
        <div className="sop-hero-stats">
          <div>
            <strong>{accountNames.length}</strong>
            <span>connected inboxes</span>
          </div>
          <div>
            <strong>{activeCases}</strong>
            <span>active case projects</span>
          </div>
          <div>
            <strong>{latestScan?.emailsScanned ?? 0}</strong>
            <span>emails in last scan</span>
          </div>
        </div>
      </section>

      <div className="sop-board">
        <section className="card sop-panel sop-panel-priority">
          <div className="sop-panel-head">
            <AlertTriangle size={18} />
            <div>
              <h3>Missed Trigger Review</h3>
              <p className="meta">30-60 day manual audit until this is fully automated.</p>
            </div>
          </div>
          <div className="sop-check-grid">
            <div>
              <strong>Main email sources</strong>
              {(accountNames.length ? accountNames : ['JDJ Law Office email', 'Jack Law email']).map((email) => (
                <label className="sop-check" key={email}>
                  <input type="checkbox" />
                  <span>{email}</span>
                </label>
              ))}
            </div>
            <div>
              <strong>Review senders/categories</strong>
              {reviewSources.map((item) => (
                <label className="sop-check" key={item}>
                  <input type="checkbox" />
                  <span>{item}</span>
                </label>
              ))}
            </div>
            <div>
              <strong>Missed trigger types</strong>
              {missedTriggerTypes.map((item) => (
                <label className="sop-check" key={item}>
                  <input type="checkbox" />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="sop-warning-strip">
            <Sparkles size={16} />
            <span>Special check: August discovery upload issue may not have been calendared. Search August-related discovery/upload/service emails and attach them to the correct case project.</span>
          </div>
          <div className="sop-action-row">
            <button className="btn-primary" type="button" onClick={onOpenCalendar}>
              <CalendarPlus size={14} /> Add missed calendar item
            </button>
            <button className="btn-ghost" type="button" onClick={onOpenTriggers}>
              Build missing trigger rule
            </button>
          </div>
        </section>

        <section className="card sop-panel">
          <div className="sop-panel-head">
            <ClipboardList size={18} />
            <div>
              <h3>Written Discovery SOP</h3>
              <p className="meta">Immediate sample for served FROGs, SROGs, RFPs, RFAs.</p>
            </div>
          </div>
          <div className="sop-step-list">
            {writtenDiscoverySteps.map((step, index) => (
              <div className="sop-step" key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="card sop-panel">
          <div className="sop-panel-head">
            <FolderKanban size={18} />
            <div>
              <h3>CMC / Court Notice SOP</h3>
              <p className="meta">Court-notice trigger with source-backed baseline rules.</p>
            </div>
          </div>
          <div className="sop-step-list">
            {cmcSteps.map((step, index) => (
              <div className="sop-step" key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </div>
            ))}
          </div>
          <div className="sop-source-row">
            <a href="https://courts.ca.gov/cms/rules/index/three/rule3_725" target="_blank" rel="noreferrer">CRC 3.725</a>
            <a href="https://courts.ca.gov/cms/rules/index/three/rule3_724" target="_blank" rel="noreferrer">CRC 3.724</a>
            <a href="https://selfhelp.courts.ca.gov/jcc-form/CM-110" target="_blank" rel="noreferrer">CM-110</a>
          </div>
        </section>
      </div>

      <section className="card sop-master-card">
        <div className="sop-panel-head">
          <CheckCircle2 size={18} />
          <div>
            <h3>SOP Master List</h3>
            <p className="meta">Beginning-to-end case workflow. Each item becomes a future automation rule.</p>
          </div>
        </div>
        <div className="sop-table-wrap">
          <table className="sop-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Trigger</th>
                <th>Rule / deadline</th>
                <th>Calendar entries</th>
                <th>Templates</th>
                <th>Owner</th>
                <th>Ticklers</th>
              </tr>
            </thead>
            <tbody>
              {sopItems.map((item) => (
                <tr key={item.phase}>
                  <td><strong>{item.phase}</strong></td>
                  <td>{item.trigger}</td>
                  <td>{item.rule}</td>
                  <td>{item.calendar}</td>
                  <td>{item.templates}</td>
                  <td>{item.owner}</td>
                  <td>{item.ticklers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card sop-panel">
        <div className="sop-panel-head">
          <FolderKanban size={18} />
          <div>
            <h3>Data Migration / Database Building</h3>
            <p className="meta">Get data accessible first. Duplicate cleanup can come later.</p>
          </div>
        </div>
        <div className="sop-migration-grid">
          {migrationTasks.map((task) => (
            <label className="sop-check" key={task}>
              <input type="checkbox" />
              <span>{task}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
