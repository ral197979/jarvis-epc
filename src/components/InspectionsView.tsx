import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useDeepLink } from '../hooks/useDeepLink';
import { downloadCsv } from '../utils/csv';

interface ChecklistItem {
  id: string;
  text: string;
  required?: boolean;
  spec_ref?: string;
  category?: string;
}

interface InspectionTemplate {
  id: string;
  name: string;
  category: string;
  discipline: string;
  checklist: ChecklistItem[];
  version: number;
  is_active: boolean;
}

interface InspectionResult {
  item_id: string;
  text?: string;
  result: 'pass' | 'fail' | 'na';
  notes?: string;
  required?: boolean;
  spec_ref?: string;
}

interface Inspection {
  id: string;
  project_id: string;
  template_id?: string;
  inspection_number: string;
  title: string;
  type?: string;
  location?: string;
  discipline?: string;
  status: 'scheduled' | 'in_progress' | 'completed';
  scheduled_date?: string;
  completed_date?: string;
  inspector_id?: string;
  results?: InspectionResult[];
  pass_count: number;
  fail_count: number;
  na_count: number;
  overall_result?: 'pass' | 'fail';
  notes?: string;
  template_name?: string;
  checklist?: ChecklistItem[];
  created_at: string;
}

interface Project {
  id: string;
  name: string;
}

const SEED_TEMPLATES: Array<Omit<InspectionTemplate, 'id' | 'version' | 'is_active'>> = [
  {
    name: 'Fire-Stop Penetration (UL 1479)',
    category: 'Fire/Life Safety',
    discipline: 'Fire Protection',
    checklist: [
      { id: '1', text: 'Penetration opening cleaned of debris and laitance', required: true, spec_ref: 'UL 1479 §4.1' },
      { id: '2', text: 'Annular space within UL listing tolerance', required: true, spec_ref: 'UL 1479 §6.2' },
      { id: '3', text: 'Sleeve/firestop manufacturer matches submittal', required: true },
      { id: '4', text: 'Backing material installed per UL system', required: true },
      { id: '5', text: 'Sealant depth meets F-rating requirement', required: true },
      { id: '6', text: 'Sealant cured per manufacturer instructions' },
      { id: '7', text: 'Penetration ID label affixed and legible', required: true },
      { id: '8', text: 'Photo documentation captured (before, during, after)' },
      { id: '9', text: 'No combustible material within 1" of opening' }
    ]
  },
  {
    name: 'MEP Rough-In',
    category: 'MEP',
    discipline: 'MEP',
    checklist: [
      { id: '1', text: 'Pipe routing matches approved coordination drawings', required: true },
      { id: '2', text: 'Hangers and supports per NEC 300.11 / NFPA 13', required: true },
      { id: '3', text: 'Slope on drainage piping per IPC (1/4" per ft min)', required: true },
      { id: '4', text: 'Conduit fill ratio within NEC Ch 9 Table 1' },
      { id: '5', text: 'Pull boxes accessible per NEC 314.29', required: true },
      { id: '6', text: 'Ductwork sealed per SMACNA Class A/B as required' },
      { id: '7', text: 'Insulation R-value matches spec (ASHRAE 90.1)' },
      { id: '8', text: 'Penetrations through fire-rated walls firestopped', required: true },
      { id: '9', text: 'No conflicts with structural steel or BIM clashes' },
      { id: '10', text: 'Equipment clearances per NEC 110.26 / mfr O&M', required: true },
      { id: '11', text: 'Photo documentation of concealed work' }
    ]
  },
  {
    name: 'Concrete Pre-Pour (ACI 318)',
    category: 'Civil/Structural',
    discipline: 'Structural',
    checklist: [
      { id: '1', text: 'Reinforcement size, spacing, cover per shop drawings', required: true, spec_ref: 'ACI 318 §20.6' },
      { id: '2', text: 'Lap splices meet length requirements', required: true, spec_ref: 'ACI 318 §25.5' },
      { id: '3', text: 'Forms clean, plumb, braced, oiled', required: true },
      { id: '4', text: 'Embeds, sleeves, anchor bolts located per AB drawings', required: true },
      { id: '5', text: 'Construction joints prepared (clean, roughened, wet)' },
      { id: '6', text: 'Slump and temperature check ready (ASTM C172/C31)', required: true },
      { id: '7', text: 'Cylinder molds on site for sampling', required: true },
      { id: '8', text: 'Pour rate, sequence, vibration plan reviewed' },
      { id: '9', text: 'Curing materials staged (blankets, water, compound)' },
      { id: '10', text: 'Special inspector notified and on site', required: true }
    ]
  },
  {
    name: 'Utility Bedding (ASTM D2321)',
    category: 'Civil',
    discipline: 'Civil',
    checklist: [
      { id: '1', text: 'Trench width matches design / O.D. + clearance', required: true, spec_ref: 'ASTM D2321 §6' },
      { id: '2', text: 'Foundation soil firm, dewatered, no soft spots', required: true },
      { id: '3', text: 'Bedding material gradation per spec (Class I/II)', required: true },
      { id: '4', text: 'Bedding thickness ≥ 4" or per design', required: true },
      { id: '5', text: 'Pipe joints fully homed with lubricant' },
      { id: '6', text: 'Initial backfill compacted to 12" above pipe', required: true },
      { id: '7', text: 'No rocks larger than 1.5" in initial backfill zone' },
      { id: '8', text: 'Tracer wire and warning tape installed' }
    ]
  },
  {
    name: 'RO/NF Membrane Commissioning',
    category: 'Water Treatment',
    discipline: 'Process',
    checklist: [
      { id: '1', text: 'Pre-flush cycle per mfr (45-60 min low-pressure)', required: true },
      { id: '2', text: 'CIP skid valves staged in run position' },
      { id: '3', text: 'Antiscalant dosing pump primed and calibrated', required: true },
      { id: '4', text: 'pH adjustment chemical staged and dosing verified' },
      { id: '5', text: 'Permeate conductivity meter calibrated to 2-pt std', required: true },
      { id: '6', text: 'Feed/concentrate pressure gauges within ±2% of cal' },
      { id: '7', text: 'Recovery rate within design (typ 75-85%)', required: true },
      { id: '8', text: 'Salt rejection ≥ 98% (mfr nameplate spec)', required: true },
      { id: '9', text: 'Flux LMH within design envelope (15-25 typical)' },
      { id: '10', text: 'Differential pressure across each stage logged', required: true },
      { id: '11', text: 'Membrane integrity test (vacuum decay) passed', required: true },
      { id: '12', text: 'CIP loop tested with NaOH and citric flush' },
      { id: '13', text: 'PLC trends logged for 4-hr stability run', required: true }
    ]
  },
  {
    name: 'VFD Pre-Start (Schneider ATV / WEG CFW)',
    category: 'Electrical',
    discipline: 'Electrical',
    checklist: [
      { id: '1', text: 'Drive nameplate matches motor FLA and voltage', required: true },
      { id: '2', text: 'Input/output cable lugs torqued to spec', required: true, spec_ref: 'NETA ATS 7.19' },
      { id: '3', text: 'Megger insulation test on motor leads ≥ 5 MΩ', required: true, spec_ref: 'IEEE 43' },
      { id: '4', text: 'Drive grounding (PE) bonded to building steel', required: true },
      { id: '5', text: 'Shielded VFD cable bonded both ends' },
      { id: '6', text: 'Carrier frequency set per cable length / motor type' },
      { id: '7', text: 'Acceleration / deceleration ramps configured' },
      { id: '8', text: 'Overload protection (motor thermal) enabled', required: true },
      { id: '9', text: 'Modbus/Ethernet IP comm tested with PLC' },
      { id: '10', text: 'Jog forward and reverse rotation verified', required: true },
      { id: '11', text: 'Run at 25/50/75/100% — current within 110% FLA', required: true }
    ]
  },
  {
    name: 'BAS Point-to-Point (BACnet/Modbus)',
    category: 'Controls',
    discipline: 'Controls',
    checklist: [
      { id: '1', text: 'Point list matches submittal (AI/AO/BI/BO counts)', required: true, spec_ref: 'ASHRAE 135' },
      { id: '2', text: 'Each AI: simulate signal, verify graphic value', required: true },
      { id: '3', text: 'Each AO: command 0/50/100%, verify field response', required: true },
      { id: '4', text: 'Each BI: cycle field contact, verify alarm/state' },
      { id: '5', text: 'Each BO: command on/off, verify equipment response', required: true },
      { id: '6', text: 'BACnet device ID unique on subnet', required: true },
      { id: '7', text: 'MS/TP MAC addresses sequential, no gaps' },
      { id: '8', text: 'Trend logs configured at design intervals' },
      { id: '9', text: 'Alarm priorities and routing tested', required: true },
      { id: '10', text: 'Schedule overrides tested (AM/PM, weekend)' },
      { id: '11', text: 'Graphics navigation tree complete and labeled' }
    ]
  }
];

export default function InspectionsView(props: { policy?: any; biz?: any; onNavigate?: (tab: string) => void; onToast?: (m: string, t?: string) => void; onAudit?: (e: unknown) => void }) {
  const { onToast, onAudit } = props
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'scheduled' | 'in_progress' | 'completed'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'inspections' | 'templates'>('inspections');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const [activeInspection, setActiveInspection] = useState<Inspection | null>(null);
  const deepLink = useDeepLink('inspection');
  const deepLinkOpened = useRef(false);
  const [activeChecklist, setActiveChecklist] = useState<ChecklistItem[]>([]);
  const [activeResults, setActiveResults] = useState<InspectionResult[]>([]);
  const [activeNotes, setActiveNotes] = useState('');
  const [signatures, setSignatures] = useState<Array<{ name: string; role?: string; signed_at: string; data_url: string }>>([]);
  const [sigDrawing, setSigDrawing] = useState(false);
  const [sigName, setSigName] = useState('');
  const [sigRole, setSigRole] = useState('');
  const sigCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const sigLastRef = React.useRef<{ x: number; y: number } | null>(null);

  const [createForm, setCreateForm] = useState({
    title: '',
    template_id: '',
    type: 'pre_install',
    location: '',
    discipline: 'MEP',
    scheduled_date: '',
    notes: ''
  });

  const [tplForm, setTplForm] = useState({
    name: '',
    category: 'MEP',
    discipline: 'MEP',
    checklist: [{ id: '1', text: '', required: false }] as ChecklistItem[]
  });

  // ─── Init projects ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v1/projects', { credentials: 'include' });
        const json = await res.json();
        setProjects(json.data || []);
        const saved = localStorage.getItem('jarvis-active-project');
        if (saved && json.data?.some((p: Project) => p.id === saved)) {
          setProjectId(saved);
        } else if (json.data?.length > 0) {
          setProjectId(json.data[0].id);
          localStorage.setItem('jarvis-active-project', json.data[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch projects:', err);
      }
    })();
  }, []);

  // ─── Fetch inspections + templates when project changes ────────────────────
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      setLoading(true);
      try {
        const [iRes, tRes] = await Promise.all([
          fetch(`/api/v1/projects/${projectId}/inspections`, { credentials: 'include' }),
          fetch(`/api/v1/projects/${projectId}/inspection-templates`, { credentials: 'include' })
        ]);
        const iJson = await iRes.json();
        const tJson = await tRes.json();
        setInspections(iJson.inspections || iJson.data || []);
        setTemplates(tJson.templates || tJson.data || []);
      } catch (err) {
        console.error('Failed to fetch inspections/templates:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  // ─── Seed defaults if tenant has zero templates ────────────────────────────
  const seedDefaults = async () => {
    if (!confirm(`Install ${SEED_TEMPLATES.length} default inspection templates (UL 1479 firestop, ACI 318 concrete, RO/NF, VFD, BAS, etc.)?`)) return;
    try {
      const created: InspectionTemplate[] = [];
      for (const tpl of SEED_TEMPLATES) {
        const res = await fetch('/api/v1/inspection-templates', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tpl)
        });
        const json = await res.json();
        if (res.ok && json.template) created.push(json.template);
      }
      setTemplates([...templates, ...created]);
      alert(`Seeded ${created.length} templates.`);
    } catch (err) {
      console.error('Seed failed:', err);
      alert('Seed failed — check console.');
    }
  };

  // ─── Create inspection ─────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!projectId || !createForm.title) {
      alert('Title required.');
      return;
    }
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/inspections`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...createForm,
          template_id: createForm.template_id || null
        })
      });
      const json = await res.json();
      if (res.ok && json.inspection) {
        setInspections([json.inspection, ...inspections]);
        setShowCreateModal(false);
        setCreateForm({ title: '', template_id: '', type: 'pre_install', location: '', discipline: 'MEP', scheduled_date: '', notes: '' });
      } else {
        alert(json.error || 'Failed to create inspection.');
      }
    } catch (err) {
      console.error('Create failed:', err);
    }
  };

  // ─── Open run dialog (load checklist from template) ───────────────────────
  const openRun = async (insp: Inspection) => {
    try {
      const res = await fetch(`/api/v1/inspections/${insp.id}`, { credentials: 'include' });
      const json = await res.json();
      const full = json.inspection ?? insp;
      const checklist: ChecklistItem[] = (full.checklist as ChecklistItem[]) ?? [];
      const existingResults: InspectionResult[] = (full.results as InspectionResult[]) ?? [];
      // Initialize results array — prefer existing, fall back to default 'pass'
      const initial: InspectionResult[] = checklist.map(item => {
        const prev = existingResults.find(r => r.item_id === item.id);
        return prev ?? { item_id: item.id, text: item.text, result: 'pass', required: item.required, spec_ref: item.spec_ref };
      });
      setActiveInspection(full);
      setActiveChecklist(checklist);
      setActiveResults(initial);
      setActiveNotes(full.notes ?? '');
      setShowRunModal(true);

      if (full.status === 'scheduled') {
        // Auto-bump to in_progress
        await fetch(`/api/v1/inspections/${insp.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'in_progress' })
        });
        setInspections(inspections.map(i => i.id === insp.id ? { ...i, status: 'in_progress' as const } : i));
      }
    } catch (err) {
      console.error('Open run failed:', err);
    }
  };

  // Deep-link: open the inspection a Focus card pointed at, once the list loads.
  useEffect(() => {
    if (deepLinkOpened.current || !deepLink?.sourceId || inspections.length === 0) return;
    const target = inspections.find(i => i.id === deepLink.sourceId);
    if (target) { openRun(target); deepLinkOpened.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, inspections]);

  const updateResult = (idx: number, patch: Partial<InspectionResult>) => {
    setActiveResults(activeResults.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const saveProgress = async () => {
    if (!activeInspection) return;
    try {
      const res = await fetch(`/api/v1/inspections/${activeInspection.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: activeResults, notes: activeNotes })
      });
      const json = await res.json();
      if (res.ok && json.inspection) {
        setInspections(inspections.map(i => i.id === activeInspection.id ? json.inspection : i));
        alert('Progress saved.');
      }
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  const finalize = async () => {
    if (!activeInspection) return;
    const requiredFails = activeResults.filter(r => r.result === 'fail' && r.required);
    if (requiredFails.length > 0) {
      const ok = confirm(`${requiredFails.length} required item(s) failed. This inspection will be marked FAIL.\nProceed?`);
      if (!ok) return;
    }
    try {
      // Save current state first
      await fetch(`/api/v1/inspections/${activeInspection.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: activeResults, notes: activeNotes })
      });
      // Then complete
      const res = await fetch(`/api/v1/inspections/${activeInspection.id}/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed_date: new Date().toISOString().slice(0, 10), signatures })
      });
      const json = await res.json();
      if (res.ok && json.inspection) {
        setInspections(inspections.map(i => i.id === activeInspection.id ? json.inspection : i));
        setShowRunModal(false);
        setActiveInspection(null);
        setSignatures([]); setSigName(''); setSigRole('');
        onToast?.(`Inspection ${json.inspection.overall_result === 'pass' ? 'passed' : json.inspection.overall_result === 'fail' ? 'failed' : 'completed'}`, json.inspection.overall_result === 'fail' ? 'warn' : 'success');
        onAudit?.({ type: 'inspection.completed', id: json.inspection.id, result: json.inspection.overall_result });

        // If failed, prompt to auto-create a punch list
        const failed = activeResults.filter(r => r.result === 'fail');
        if (failed.length > 0) {
          const create = confirm(`${failed.length} item(s) failed. Create punch list with deficiencies?`);
          if (create) {
            await createPunchListFromFailures(json.inspection, failed);
          }
        }
      }
    } catch (err) {
      console.error('Finalize failed:', err);
    }
  };

  // ─── Auto-generate punch list from failed checks ───────────────────────────
  const createPunchListFromFailures = async (insp: Inspection, failures: InspectionResult[]) => {
    try {
      // Create the punch list
      const listRes = await fetch(`/api/v1/projects/${projectId}/punch-lists`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Inspection ${insp.inspection_number} — Deficiencies`,
          description: `Auto-generated from inspection ${insp.inspection_number} (${insp.title})`
        })
      });
      const listJson = await listRes.json();
      const listId = listJson.punchList?.id ?? listJson.punch_list?.id ?? listJson.data?.id;
      if (!listId) {
        console.warn('Could not create punch list, raw response:', listJson);
        return;
      }
      // Add a punch item per failed check
      for (const fail of failures) {
        await fetch(`/api/v1/punch-lists/${listId}/items`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Deficiency: ${fail.text ?? fail.item_id}`,
            description: fail.notes ?? '',
            location: insp.location ?? '',
            discipline: insp.discipline ?? '',
            priority: fail.required ? 'high' : 'medium'
          })
        });
      }
      alert(`Punch list created with ${failures.length} item(s). Open Punch Lists tab to review.`);
    } catch (err) {
      console.error('Punch list create failed:', err);
    }
  };

  // ─── Custom template builder ───────────────────────────────────────────────
  const addTplItem = () => {
    setTplForm({
      ...tplForm,
      checklist: [...tplForm.checklist, { id: String(tplForm.checklist.length + 1), text: '', required: false }]
    });
  };
  const updateTplItem = (idx: number, patch: Partial<ChecklistItem>) => {
    setTplForm({
      ...tplForm,
      checklist: tplForm.checklist.map((c, i) => i === idx ? { ...c, ...patch } : c)
    });
  };
  const removeTplItem = (idx: number) => {
    setTplForm({
      ...tplForm,
      checklist: tplForm.checklist.filter((_, i) => i !== idx)
    });
  };
  const saveCustomTemplate = async () => {
    const valid = tplForm.checklist.filter(c => c.text.trim());
    if (!tplForm.name || valid.length === 0) {
      alert('Template name and at least one checklist item required.');
      return;
    }
    try {
      const res = await fetch('/api/v1/inspection-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tplForm, checklist: valid })
      });
      const json = await res.json();
      if (res.ok && json.template) {
        setTemplates([...templates, json.template]);
        setShowTemplateModal(false);
        setTplForm({ name: '', category: 'MEP', discipline: 'MEP', checklist: [{ id: '1', text: '', required: false }] });
      }
    } catch (err) {
      console.error('Template create failed:', err);
    }
  };

  // ─── Filtering + stats ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return inspections.filter(insp => {
      if (filterStatus !== 'all' && insp.status !== filterStatus) return false;
      if (searchTerm && !insp.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [inspections, filterStatus, searchTerm]);

  const stats = useMemo(() => ({
    total: inspections.length,
    scheduled: inspections.filter(i => i.status === 'scheduled').length,
    in_progress: inspections.filter(i => i.status === 'in_progress').length,
    passed: inspections.filter(i => i.status === 'completed' && i.overall_result === 'pass').length,
    failed: inspections.filter(i => i.status === 'completed' && i.overall_result === 'fail').length,
    pass_rate: (() => {
      const completed = inspections.filter(i => i.status === 'completed').length;
      if (completed === 0) return 0;
      return Math.round((inspections.filter(i => i.status === 'completed' && i.overall_result === 'pass').length / completed) * 100);
    })()
  }), [inspections]);

  const statusColor = (s: string) => ({
    scheduled: 'var(--jarvis-amb)',
    in_progress: '#3b82f6',
    completed: 'var(--jarvis-grn)'
  } as Record<string, string>)[s] ?? 'var(--jarvis-ts)';

  const resultColor = (r?: string) => r === 'pass' ? 'var(--jarvis-grn)' : r === 'fail' ? 'var(--jarvis-red)' : 'var(--jarvis-ts)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--jarvis-bg)', color: 'var(--jarvis-ts)' }}>
      {/* Project Selector + Tabs */}
      <div style={{ padding: '16px', borderBottom: '1px solid var(--jarvis-card)', background: 'var(--jarvis-card)', display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '14px', fontWeight: '500' }}>Project:</label>
          <select
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value); }}
            style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-card)', color: 'inherit', cursor: 'pointer' }}
          >
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['inspections', 'templates'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                padding: '6px 14px',
                background: activeTab === t ? 'var(--jarvis-accent)' : 'transparent',
                color: activeTab === t ? 'white' : 'var(--jarvis-ts)',
                border: '1px solid var(--jarvis-accent)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                textTransform: 'capitalize'
              }}
            >
              {t === 'inspections' ? `Inspections (${inspections.length})` : `Templates (${templates.length})`}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'inspections' && (
        <>
          {/* KPI Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', padding: '16px', background: 'var(--jarvis-card)' }}>
            {[
              { label: 'Total', value: stats.total },
              { label: 'Scheduled', value: stats.scheduled },
              { label: 'In Progress', value: stats.in_progress },
              { label: 'Passed', value: stats.passed, color: 'var(--jarvis-grn)' },
              { label: 'Failed', value: stats.failed, color: 'var(--jarvis-red)' },
              { label: 'Pass Rate', value: `${stats.pass_rate}%`, color: stats.pass_rate >= 90 ? 'var(--jarvis-grn)' : stats.pass_rate >= 70 ? 'var(--jarvis-amb)' : 'var(--jarvis-red)' }
            ].map(kpi => (
              <div key={kpi.label} style={{ textAlign: 'center', padding: '12px', background: 'var(--jarvis-bg)', borderRadius: '8px' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: (kpi as any).color || 'var(--jarvis-accent)' }}>{kpi.value}</div>
                <div style={{ fontSize: '12px', color: 'var(--jarvis-ts)', marginTop: '4px' }}>{kpi.label}</div>
              </div>
            ))}
          </div>

          {/* Filter Bar */}
          <div style={{ padding: '16px', background: 'var(--jarvis-card)', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search inspections..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="jarvis-input"
              style={{ flex: 1, minWidth: '200px' }}
            />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)} className="jarvis-input" style={{ width: '160px' }}>
              <option value="all">All Status</option>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
            <button
              onClick={() => setShowCreateModal(true)}
              className="jarvis-btn"
              style={{ background: 'var(--jarvis-accent)', color: 'white', padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
            >
              + New Inspection
            </button>
            <button
              onClick={() => downloadCsv(`inspections-${new Date().toISOString().slice(0,10)}.csv`, inspections.map(i => ({
                id: i.id, project_id: i.project_id, title: i.title, status: i.status,
                scheduled_date: i.scheduled_date, completed_date: (i as any).completed_date ?? '',
                pass_count: (i as any).pass_count ?? '', fail_count: (i as any).fail_count ?? '',
                na_count: (i as any).na_count ?? '', overall_result: (i as any).overall_result ?? ''
              })))}
              disabled={!inspections.length}
              style={{ padding: '8px 14px', border: '1px solid var(--jarvis-accent)', background: 'transparent', color: 'var(--jarvis-accent)', borderRadius: '6px', cursor: inspections.length ? 'pointer' : 'not-allowed', marginLeft: 8, opacity: inspections.length ? 1 : 0.5 }}
              title="Export inspections to CSV"
            >
              ⬇ CSV
            </button>
          </div>

          {/* Table */}
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            {loading ? (
              <div className="jarvis-empty">Loading inspections...</div>
            ) : filtered.length === 0 ? (
              <div className="jarvis-empty" style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>✅</div>
                <div style={{ marginBottom: '8px' }}>No inspections yet</div>
                <div style={{ fontSize: '12px', marginBottom: '16px' }}>Templates available: {templates.length}. Click + New Inspection to schedule one.</div>
              </div>
            ) : (
              <table className="jarvis-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--jarvis-card)' }}>
                    <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>#</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>Title</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>Type</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>Discipline</th>
                    <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>Result</th>
                    <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>Pass/Fail/N/A</th>
                    <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(insp => (
                    <tr
                      key={insp.id}
                      onClick={() => openRun(insp)}
                      style={{ borderBottom: '1px solid var(--jarvis-card)', cursor: 'pointer', background: 'var(--jarvis-bg)', transition: 'background 0.2s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--jarvis-card)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--jarvis-bg)')}
                    >
                      <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'var(--jarvis-font-mono)' }}>{insp.inspection_number}</td>
                      <td style={{ padding: '12px', fontSize: '13px', fontWeight: 500 }}>{insp.title}</td>
                      <td style={{ padding: '12px', fontSize: '13px' }}>{insp.type ?? '—'}</td>
                      <td style={{ padding: '12px', fontSize: '13px' }}>{insp.discipline ?? '—'}</td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 500, background: statusColor(insp.status) + '20', color: statusColor(insp.status) }}>
                          {insp.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        {insp.overall_result ? (
                          <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, background: resultColor(insp.overall_result) + '20', color: resultColor(insp.overall_result) }}>
                            {insp.overall_result.toUpperCase()}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontFamily: 'var(--jarvis-font-mono)' }}>
                        <span style={{ color: 'var(--jarvis-grn)' }}>{insp.pass_count}</span>
                        {' / '}
                        <span style={{ color: 'var(--jarvis-red)' }}>{insp.fail_count}</span>
                        {' / '}
                        <span>{insp.na_count}</span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', fontSize: '13px' }}>
                        {insp.completed_date ? new Date(insp.completed_date).toLocaleDateString() : insp.scheduled_date ? new Date(insp.scheduled_date).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {activeTab === 'templates' && (
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--jarvis-ts)' }}>Inspection Templates ({templates.length})</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {templates.length === 0 && (
                <button
                  onClick={seedDefaults}
                  style={{ background: 'var(--jarvis-amb)', color: 'white', padding: '8px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                >
                  ⚡ Seed Default Templates ({SEED_TEMPLATES.length})
                </button>
              )}
              <button
                onClick={() => setShowTemplateModal(true)}
                className="jarvis-btn"
                style={{ background: 'var(--jarvis-accent)', color: 'white', padding: '8px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
              >
                + New Template
              </button>
            </div>
          </div>
          {templates.length === 0 ? (
            <div className="jarvis-empty" style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
              <div>No templates installed.</div>
              <div style={{ fontSize: '12px', marginTop: '8px' }}>Click "Seed Default Templates" to install {SEED_TEMPLATES.length} pre-built checklists (UL 1479 firestop, ACI 318 concrete pre-pour, RO/NF commissioning, VFD pre-start, BAS point-to-point, etc.)</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {templates.map(tpl => (
                <div key={tpl.id} style={{ background: 'var(--jarvis-card)', borderRadius: '8px', padding: '14px', borderLeft: '3px solid var(--jarvis-accent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>{tpl.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--jarvis-ts)', marginTop: '2px' }}>{tpl.discipline} · {tpl.category}</div>
                    </div>
                    <span style={{ fontSize: '11px', background: 'var(--jarvis-bg)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'var(--jarvis-font-mono)' }}>v{tpl.version}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--jarvis-ts)' }}>
                    {Array.isArray(tpl.checklist) ? tpl.checklist.length : 0} items · {Array.isArray(tpl.checklist) ? tpl.checklist.filter((c: ChecklistItem) => c.required).length : 0} required
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Inspection Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--jarvis-card)', borderRadius: '8px', padding: '24px', maxWidth: '520px', width: '90%', maxHeight: '85vh', overflow: 'auto' }}>
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: 'var(--jarvis-accent)' }}>Schedule New Inspection</h2>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Title *</label>
              <input type="text" placeholder="e.g. Level 3 MEP Rough-In Inspection" value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} className="jarvis-input" style={{ width: '100%' }} />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Template</label>
              <select value={createForm.template_id} onChange={(e) => setCreateForm({ ...createForm, template_id: e.target.value })} className="jarvis-input" style={{ width: '100%' }}>
                <option value="">— No template (free-form) —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Type</label>
                <select value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })} className="jarvis-input" style={{ width: '100%' }}>
                  <option value="pre_install">Pre-Install</option>
                  <option value="in_progress">In-Progress</option>
                  <option value="final">Final</option>
                  <option value="commissioning">Commissioning</option>
                  <option value="punchlist">Punch List</option>
                  <option value="ahj">AHJ / Code Official</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Discipline</label>
                <select value={createForm.discipline} onChange={(e) => setCreateForm({ ...createForm, discipline: e.target.value })} className="jarvis-input" style={{ width: '100%' }}>
                  <option value="MEP">MEP</option>
                  <option value="Structural">Structural</option>
                  <option value="Civil">Civil</option>
                  <option value="Electrical">Electrical</option>
                  <option value="Controls">Controls</option>
                  <option value="Process">Process</option>
                  <option value="Fire Protection">Fire Protection</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Location</label>
                <input type="text" placeholder="Level 3 / Mech Room A" value={createForm.location} onChange={(e) => setCreateForm({ ...createForm, location: e.target.value })} className="jarvis-input" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Scheduled Date</label>
                <input type="date" value={createForm.scheduled_date} onChange={(e) => setCreateForm({ ...createForm, scheduled_date: e.target.value })} className="jarvis-input" style={{ width: '100%' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button onClick={() => setShowCreateModal(false)} style={{ padding: '8px 16px', border: '1px solid var(--jarvis-card)', background: 'transparent', color: 'var(--jarvis-ts)', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreate} className="jarvis-btn" style={{ background: 'var(--jarvis-accent)', color: 'white', padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* Run Inspection Modal */}
      {showRunModal && activeInspection && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--jarvis-card)', borderRadius: '8px', padding: '24px', maxWidth: '780px', width: '92%', maxHeight: '92vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <h2 style={{ margin: 0, color: 'var(--jarvis-accent)' }}>{activeInspection.inspection_number}</h2>
                <div style={{ fontSize: '14px', marginTop: '4px' }}>{activeInspection.title}</div>
                <div style={{ fontSize: '12px', color: 'var(--jarvis-ts)', marginTop: '4px' }}>
                  {activeInspection.discipline ?? '—'} · {activeInspection.location ?? '—'} · {activeInspection.template_name ?? 'free-form'}
                </div>
              </div>
              <button onClick={() => { setShowRunModal(false); setSignatures([]); setSigName(''); setSigRole(''); }} style={{ background: 'transparent', border: 'none', color: 'var(--jarvis-ts)', fontSize: '20px', cursor: 'pointer' }}>×</button>
            </div>

            {activeChecklist.length === 0 ? (
              <div className="jarvis-empty" style={{ padding: '20px' }}>
                No checklist attached. Add free-form notes below or edit the inspection to attach a template.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {activeChecklist.map((item, idx) => {
                  const r = activeResults[idx];
                  return (
                    <div key={item.id} style={{ background: 'var(--jarvis-bg)', borderRadius: '6px', padding: '10px', borderLeft: `3px solid ${resultColor(r?.result)}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                        <div style={{ flex: 1, fontSize: '13px' }}>
                          <span style={{ color: 'var(--jarvis-ts)', marginRight: '6px' }}>{idx + 1}.</span>
                          {item.text}
                          {item.required && <span style={{ color: 'var(--jarvis-red)', marginLeft: '6px', fontSize: '10px' }}>REQ</span>}
                          {item.spec_ref && <div style={{ fontSize: '10px', color: 'var(--jarvis-ts)', marginTop: '2px', fontFamily: 'var(--jarvis-font-mono)' }}>{item.spec_ref}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {(['pass', 'fail', 'na'] as const).map(opt => (
                            <button
                              key={opt}
                              onClick={() => updateResult(idx, { result: opt })}
                              style={{
                                padding: '4px 10px',
                                fontSize: '11px',
                                fontWeight: 600,
                                borderRadius: '4px',
                                cursor: 'pointer',
                                border: '1px solid ' + (r?.result === opt ? resultColor(opt) : 'var(--jarvis-card)'),
                                background: r?.result === opt ? resultColor(opt) + '30' : 'transparent',
                                color: r?.result === opt ? resultColor(opt) : 'var(--jarvis-ts)',
                                textTransform: 'uppercase'
                              }}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                      {(r?.result === 'fail' || r?.notes) && (
                        <input
                          type="text"
                          placeholder="Note / corrective action..."
                          value={r?.notes ?? ''}
                          onChange={(e) => updateResult(idx, { notes: e.target.value })}
                          className="jarvis-input"
                          style={{ width: '100%', marginTop: '6px', fontSize: '12px' }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginBottom: '16px', border: '1px solid var(--jarvis-border, #8884)', borderRadius: 6, padding: 12 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>Signatures ({signatures.length})</label>
              {signatures.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {signatures.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid var(--jarvis-border, #8883)', borderRadius: 4 }}>
                      <img src={s.data_url} alt="sig" style={{ height: 36, background: '#fff', borderRadius: 3 }} />
                      <div style={{ flex: 1, fontSize: 12 }}>
                        <div style={{ fontWeight: 600 }}>{s.name}{s.role ? ` — ${s.role}` : ''}</div>
                        <div style={{ color: 'var(--jarvis-ts)' }}>{new Date(s.signed_at).toLocaleString()}</div>
                      </div>
                      <button type="button" onClick={() => setSignatures(signatures.filter((_, j) => j !== i))} style={{ background: 'transparent', border: '1px solid var(--jarvis-red, #e11)', color: 'var(--jarvis-red, #e11)', borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder="Signer name" className="jarvis-input" style={{ flex: '2 1 180px', fontSize: 12 }} />
                <input value={sigRole} onChange={e => setSigRole(e.target.value)} placeholder="Role (optional, e.g. AHJ, PM)" className="jarvis-input" style={{ flex: '2 1 180px', fontSize: 12 }} />
              </div>
              <canvas
                ref={sigCanvasRef}
                width={560}
                height={140}
                style={{ width: '100%', height: 140, background: '#fff', border: '1px dashed var(--jarvis-border, #8884)', borderRadius: 4, cursor: 'crosshair', touchAction: 'none' }}
                onPointerDown={(e) => {
                  const c = sigCanvasRef.current; if (!c) return;
                  (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                  const r = c.getBoundingClientRect();
                  sigLastRef.current = { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
                  setSigDrawing(true);
                }}
                onPointerMove={(e) => {
                  if (!sigDrawing) return;
                  const c = sigCanvasRef.current; if (!c) return;
                  const ctx = c.getContext('2d'); if (!ctx) return;
                  const r = c.getBoundingClientRect();
                  const x = (e.clientX - r.left) * (c.width / r.width);
                  const y = (e.clientY - r.top) * (c.height / r.height);
                  const last = sigLastRef.current;
                  if (last) {
                    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(x, y); ctx.stroke();
                  }
                  sigLastRef.current = { x, y };
                }}
                onPointerUp={() => { setSigDrawing(false); sigLastRef.current = null; }}
                onPointerLeave={() => { setSigDrawing(false); sigLastRef.current = null; }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    const c = sigCanvasRef.current; if (!c) return;
                    const ctx = c.getContext('2d'); if (!ctx) return;
                    ctx.clearRect(0, 0, c.width, c.height);
                  }}
                  style={{ padding: '6px 12px', border: '1px solid var(--jarvis-border, #8884)', background: 'transparent', color: 'var(--jarvis-ts)', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                >Clear</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!sigName.trim()) { alert('Enter signer name first.'); return; }
                    const c = sigCanvasRef.current; if (!c) return;
                    // blank detection
                    const ctx = c.getContext('2d'); const blank = document.createElement('canvas');
                    blank.width = c.width; blank.height = c.height;
                    if (ctx && c.toDataURL() === blank.toDataURL()) { alert('Signature is empty.'); return; }
                    const data_url = c.toDataURL('image/png');
                    setSignatures([...signatures, { name: sigName.trim(), role: sigRole.trim() || undefined, signed_at: new Date().toISOString(), data_url }]);
                    setSigName(''); setSigRole('');
                    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
                  }}
                  style={{ padding: '6px 12px', border: 'none', background: 'var(--jarvis-accent)', color: 'white', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >Add Signature</button>
              </div>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Overall Notes</label>
              <textarea value={activeNotes} onChange={(e) => setActiveNotes(e.target.value)} className="jarvis-input" style={{ width: '100%', minHeight: '60px', fontFamily: 'inherit' }} placeholder="General observations, follow-ups, AHJ comments..." />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '12px', color: 'var(--jarvis-ts)' }}>
                Live: <span style={{ color: 'var(--jarvis-grn)' }}>{activeResults.filter(r => r.result === 'pass').length}P</span>
                {' / '}
                <span style={{ color: 'var(--jarvis-red)' }}>{activeResults.filter(r => r.result === 'fail').length}F</span>
                {' / '}
                <span>{activeResults.filter(r => r.result === 'na').length}N/A</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={saveProgress} style={{ padding: '8px 14px', border: '1px solid var(--jarvis-accent)', background: 'transparent', color: 'var(--jarvis-accent)', borderRadius: '6px', cursor: 'pointer' }}>Save Progress</button>
                <button onClick={finalize} style={{ padding: '8px 14px', background: 'var(--jarvis-accent)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>Finalize Inspection</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Template Modal */}
      {showTemplateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--jarvis-card)', borderRadius: '8px', padding: '24px', maxWidth: '600px', width: '92%', maxHeight: '90vh', overflow: 'auto' }}>
            <h2 style={{ marginTop: 0, marginBottom: '16px', color: 'var(--jarvis-accent)' }}>New Inspection Template</h2>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Name *</label>
              <input type="text" value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} className="jarvis-input" style={{ width: '100%' }} placeholder="e.g. Cooling Tower Pre-Start" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Category</label>
                <input type="text" value={tplForm.category} onChange={(e) => setTplForm({ ...tplForm, category: e.target.value })} className="jarvis-input" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Discipline</label>
                <input type="text" value={tplForm.discipline} onChange={(e) => setTplForm({ ...tplForm, discipline: e.target.value })} className="jarvis-input" style={{ width: '100%' }} />
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Checklist Items</label>
                <button onClick={addTplItem} style={{ fontSize: '11px', padding: '4px 8px', background: 'var(--jarvis-accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>+ Add Item</button>
              </div>
              {tplForm.checklist.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', minWidth: '20px', color: 'var(--jarvis-ts)' }}>{idx + 1}.</span>
                  <input type="text" placeholder="Checklist item text..." value={item.text} onChange={(e) => updateTplItem(idx, { text: e.target.value })} className="jarvis-input" style={{ flex: 1 }} />
                  <input type="text" placeholder="Spec ref" value={item.spec_ref ?? ''} onChange={(e) => updateTplItem(idx, { spec_ref: e.target.value })} className="jarvis-input" style={{ width: '110px', fontFamily: 'var(--jarvis-font-mono)', fontSize: '11px' }} />
                  <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={item.required ?? false} onChange={(e) => updateTplItem(idx, { required: e.target.checked })} />
                    Req
                  </label>
                  <button onClick={() => removeTplItem(idx)} style={{ background: 'transparent', border: 'none', color: 'var(--jarvis-red)', cursor: 'pointer', fontSize: '14px' }}>×</button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button onClick={() => setShowTemplateModal(false)} style={{ padding: '8px 16px', border: '1px solid var(--jarvis-card)', background: 'transparent', color: 'var(--jarvis-ts)', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveCustomTemplate} className="jarvis-btn" style={{ background: 'var(--jarvis-accent)', color: 'white', padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Save Template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
