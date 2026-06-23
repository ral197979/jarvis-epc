import React, { useState, useEffect, useRef } from 'react';
import { useDeepLink } from '../hooks/useDeepLink';

interface RFI {
  id: string;
  project_id: string;
  rfi_number: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  discipline: string;
  assigned_to: string;
  raised_by: string;
  status: 'open' | 'answered' | 'closed';
  due_date: string;
  created_at: string;
  answered_at?: string;
  closed_at?: string;
  responses: Array<{ id: string; respondent: string; response_text: string; created_at: string }>;
}

interface Project {
  id: string;
  name: string;
}

export default function RFIsView(props: { policy?: any; biz?: any; onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [rfis, setRfis] = useState<RFI[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'answered' | 'closed'>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedRFI, setSelectedRFI] = useState<RFI | null>(null);
  const [responseText, setResponseText] = useState('');
  const deepLink = useDeepLink('rfi');
  const deepLinkOpened = useRef(false);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as const,
    discipline: 'Structural',
    assigned_to: '',
    due_date: '',
  });

  // Initialize project selection
  useEffect(() => {
    const fetchProjects = async () => {
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
    };
    fetchProjects();
  }, []);

  // Fetch RFIs when project changes
  useEffect(() => {
    if (!projectId) return;
    const fetchRFIs = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/rfis?project_id=${projectId}`, { credentials: 'include' });
        const json = await res.json();
        setRfis(json.data || []);
      } catch (err) {
        console.error('Failed to fetch RFIs:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchRFIs();
  }, [projectId]);

  // Deep-link: open the RFI a Focus card pointed at, once the list has loaded.
  useEffect(() => {
    if (deepLinkOpened.current || !deepLink?.sourceId || rfis.length === 0) return;
    const target = rfis.find(r => r.id === deepLink.sourceId);
    if (target) { setSelectedRFI(target); setShowDetailModal(true); deepLinkOpened.current = true; }
  }, [deepLink, rfis]);

  const handleCreateRFI = async () => {
    if (!projectId || !formData.title || !formData.due_date) {
      alert('Please fill all required fields');
      return;
    }
    try {
      const res = await fetch('/api/v1/rfis', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          ...formData,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setRfis([json.data, ...rfis]);
        setShowCreateModal(false);
        setFormData({
          title: '',
          description: '',
          priority: 'medium',
          discipline: 'Structural',
          assigned_to: '',
          due_date: '',
        });
      }
    } catch (err) {
      console.error('Failed to create RFI:', err);
    }
  };

  const handleRespond = async () => {
    if (!selectedRFI || !responseText.trim()) {
      alert('Please enter a response');
      return;
    }
    try {
      const res = await fetch(`/api/v1/rfis/${selectedRFI.id}/respond`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_text: responseText }),
      });
      const json = await res.json();
      if (res.ok) {
        setRfis(rfis.map(r => (r.id === selectedRFI.id ? json.data : r)));
        setSelectedRFI(json.data);
        setResponseText('');
      }
    } catch (err) {
      console.error('Failed to respond to RFI:', err);
    }
  };

  const filteredRfis = rfis.filter(rfi => {
    if (filterStatus !== 'all' && rfi.status !== filterStatus) return false;
    if (filterPriority !== 'all' && rfi.priority !== filterPriority) return false;
    if (searchTerm && !rfi.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: rfis.length,
    open: rfis.filter(r => r.status === 'open').length,
    overdue: rfis.filter(r => r.status === 'open' && new Date(r.due_date) < new Date()).length,
    answered: rfis.filter(r => r.status === 'answered').length,
    closed: rfis.filter(r => r.status === 'closed').length,
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      critical: 'var(--jarvis-red)',
      high: 'var(--jarvis-amb)',
      medium: '#f59e0b',
      low: 'var(--jarvis-grn)',
    };
    return colors[priority] || 'var(--jarvis-ts)';
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      open: 'var(--jarvis-amb)',
      answered: '#3b82f6',
      closed: 'var(--jarvis-grn)',
    };
    return colors[status] || 'var(--jarvis-ts)';
  };

  const ballInCourt = (rfi: RFI) => {
    if (rfi.status === 'open') return rfi.assigned_to || 'Unassigned';
    if (rfi.status === 'answered') return rfi.raised_by;
    return '—';
  };

  const daysOpen = (rfi: RFI) => {
    return Math.floor((new Date().getTime() - new Date(rfi.created_at).getTime()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--jarvis-bg)', color: 'var(--jarvis-ts)' }}>
      {/* Project Selector */}
      <div style={{ padding: '16px', borderBottom: '1px solid var(--jarvis-card)', background: 'var(--jarvis-card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '14px', fontWeight: '500' }}>Project:</label>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              localStorage.setItem('jarvis-active-project', e.target.value);
            }}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'var(--jarvis-bg)',
              border: '1px solid var(--jarvis-card)',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', padding: '16px', background: 'var(--jarvis-card)' }}>
        {[
          { label: 'Total', value: stats.total },
          { label: 'Open', value: stats.open },
          { label: 'Overdue', value: stats.overdue },
          { label: 'Answered', value: stats.answered },
          { label: 'Closed', value: stats.closed },
        ].map(kpi => (
          <div key={kpi.label} style={{ textAlign: 'center', padding: '12px', background: 'var(--jarvis-bg)', borderRadius: '8px' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--jarvis-accent)' }}>{kpi.value}</div>
            <div style={{ fontSize: '12px', color: 'var(--jarvis-ts)', marginTop: '4px' }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div style={{ padding: '16px', background: 'var(--jarvis-card)', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search RFIs..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="jarvis-input"
          style={{ flex: 1, minWidth: '200px' }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          className="jarvis-input"
          style={{ width: '150px' }}
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="answered">Answered</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="jarvis-input"
          style={{ width: '150px' }}
        >
          <option value="all">All Priority</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button
          onClick={() => setShowCreateModal(true)}
          className="jarvis-btn"
          style={{ background: 'var(--jarvis-accent)', color: 'white', padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          + New RFI
        </button>
      </div>

      {/* RFI Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {loading ? (
          <div className="jarvis-empty">Loading RFIs...</div>
        ) : filteredRfis.length === 0 ? (
          <div className="jarvis-empty">No RFIs found</div>
        ) : (
          <table className="jarvis-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--jarvis-card)' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--jarvis-ts)' }}>RFI#</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>Title</th>
                <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>Priority</th>
                <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>Status</th>
                <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>Assigned To</th>
                <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>Ball in Court</th>
                <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>Days Open</th>
                <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredRfis.map(rfi => (
                <tr
                  key={rfi.id}
                  onClick={() => {
                    setSelectedRFI(rfi);
                    setShowDetailModal(true);
                  }}
                  style={{
                    borderBottom: '1px solid var(--jarvis-card)',
                    cursor: 'pointer',
                    background: 'var(--jarvis-bg)',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--jarvis-card)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--jarvis-bg)')}
                >
                  <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'var(--jarvis-font-mono)' }}>{rfi.rfi_number}</td>
                  <td style={{ padding: '12px', fontSize: '13px' }}>{rfi.title}</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                      background: getPriorityColor(rfi.priority) + '20',
                      color: getPriorityColor(rfi.priority),
                    }}>
                      {rfi.priority}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                      background: getStatusColor(rfi.status) + '20',
                      color: getStatusColor(rfi.status),
                    }}>
                      {rfi.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px', fontSize: '13px' }}>{rfi.assigned_to || '—'}</td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '500' }}>{ballInCourt(rfi)}</td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '13px' }}>{daysOpen(rfi)}</td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '13px' }}>{new Date(rfi.due_date).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--jarvis-card)',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
          }}>
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: 'var(--jarvis-accent)' }}>Create New RFI</h2>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: 'var(--jarvis-ts)' }}>Title *</label>
              <input
                type="text"
                placeholder="RFI title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="jarvis-input"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: 'var(--jarvis-ts)' }}>Description</label>
              <textarea
                placeholder="Detailed description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="jarvis-input"
                style={{ width: '100%', minHeight: '100px', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: 'var(--jarvis-ts)' }}>Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                  className="jarvis-input"
                  style={{ width: '100%' }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: 'var(--jarvis-ts)' }}>Discipline</label>
                <select
                  value={formData.discipline}
                  onChange={(e) => setFormData({ ...formData, discipline: e.target.value })}
                  className="jarvis-input"
                  style={{ width: '100%' }}
                >
                  <option value="Structural">Structural</option>
                  <option value="MEP">MEP</option>
                  <option value="Architectural">Architectural</option>
                  <option value="Civil">Civil</option>
                  <option value="Fire/Life Safety">Fire/Life Safety</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: 'var(--jarvis-ts)' }}>Assigned To</label>
              <input
                type="text"
                placeholder="Name or email"
                value={formData.assigned_to}
                onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                className="jarvis-input"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: 'var(--jarvis-ts)' }}>Due Date *</label>
              <input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                className="jarvis-input"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid var(--jarvis-card)',
                  background: 'transparent',
                  color: 'var(--jarvis-ts)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRFI}
                className="jarvis-btn"
                style={{ background: 'var(--jarvis-accent)', color: 'white', padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
              >
                Create RFI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedRFI && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--jarvis-card)',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
          }}>
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: 'var(--jarvis-accent)' }}>RFI {selectedRFI.rfi_number}</h2>

            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>{selectedRFI.title}</h3>
              <p style={{ margin: '0 0 12px 0', color: 'var(--jarvis-ts)', lineHeight: '1.5' }}>{selectedRFI.description}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', color: 'var(--jarvis-ts)' }}>
                <div><strong>Status:</strong> {selectedRFI.status}</div>
                <div><strong>Priority:</strong> {selectedRFI.priority}</div>
                <div><strong>Assigned To:</strong> {selectedRFI.assigned_to || '—'}</div>
                <div><strong>Discipline:</strong> {selectedRFI.discipline}</div>
                <div><strong>Raised By:</strong> {selectedRFI.raised_by}</div>
                <div><strong>Due Date:</strong> {new Date(selectedRFI.due_date).toLocaleDateString()}</div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--jarvis-bg)', paddingTop: '16px', marginBottom: '16px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Responses ({selectedRFI.responses?.length || 0})</h3>
              <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                {selectedRFI.responses?.map(resp => (
                  <div key={resp.id} style={{
                    background: 'var(--jarvis-bg)',
                    padding: '12px',
                    borderRadius: '6px',
                    marginBottom: '8px',
                    borderLeft: '3px solid var(--jarvis-accent)',
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>{resp.respondent}</div>
                    <div style={{ fontSize: '13px', color: 'var(--jarvis-ts)', marginBottom: '4px' }}>{resp.response_text}</div>
                    <div style={{ fontSize: '11px', color: 'var(--jarvis-ts)' }}>{new Date(resp.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>

            {selectedRFI.status === 'answered' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: 'var(--jarvis-ts)' }}>Add Response</label>
                <textarea
                  placeholder="Your response..."
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  className="jarvis-input"
                  style={{ width: '100%', minHeight: '80px', fontFamily: 'inherit' }}
                />
                <button
                  onClick={handleRespond}
                  className="jarvis-btn"
                  style={{
                    marginTop: '8px',
                    background: 'var(--jarvis-accent)',
                    color: 'white',
                    padding: '8px 16px',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Submit Response
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDetailModal(false)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid var(--jarvis-card)',
                  background: 'transparent',
                  color: 'var(--jarvis-ts)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
