import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Badge, Progress, Icon, Button, Input } from '@ds'
import { useProjects, type Project } from '@adapters'
import { PageHeader } from '../../components/shared'
import { NewProjectDialog } from './NewProjectDialog'

const healthMeta: Record<Project['health'], { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  healthy: { tone: 'success', label: 'Healthy' },
  'at-risk': { tone: 'warning', label: 'At Risk' },
  critical: { tone: 'danger', label: 'Critical' },
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const { data: projects } = useProjects()
  const [newOpen, setNewOpen] = useState(false)

  return (
    <div>
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
      <PageHeader
        title="Projects"
        subtitle="Active EPC programs across all regions"
        actions={
          <>
            <Input icon="search" placeholder="Search projects…" className="w-64" />
            <Button variant="accent" onClick={() => setNewOpen(true)}><Icon name="add" size={18} /> New Project</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-3">
        {projects?.map((p) => {
          const h = healthMeta[p.health]
          return (
            <Card
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="cursor-pointer p-lg transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono-tag text-label-sm uppercase text-on-surface-variant">{p.code}</div>
                  <h3 className="mt-0.5 text-headline-sm font-bold text-primary">{p.name}</h3>
                </div>
                <Badge tone={h.tone}>{h.label}</Badge>
              </div>
              <div className="mt-2 flex items-center gap-2 text-body-sm text-on-surface-variant">
                <Icon name="business" size={16} /> {p.client}
                <span className="text-outline">·</span>
                <Icon name="public" size={16} /> {p.region}
              </div>

              <div className="mt-md">
                <div className="mb-1 flex items-center justify-between text-body-sm">
                  <span className="text-on-surface-variant">{p.phase}</span>
                  <span className="font-semibold text-primary">{p.progressPct}%</span>
                </div>
                <Progress value={p.progressPct} threshold />
              </div>

              <div className="mt-md grid grid-cols-3 gap-2 border-t border-outline-variant pt-md text-center">
                <Mini label="Budget" value={p.budgetStatus} />
                <Mini label="Schedule" value={p.scheduleStatus} />
                <Mini label="Value" value={p.contractValue} />
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono-tag text-label-sm uppercase text-on-surface-variant">{label}</div>
      <div className="mt-0.5 text-body-sm font-semibold text-primary">{value}</div>
    </div>
  )
}
