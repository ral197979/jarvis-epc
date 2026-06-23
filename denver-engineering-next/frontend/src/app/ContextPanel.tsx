import { Icon, Button, Badge, Divider, cn } from '@ds'
import { usePortfolioInsights, useProjects } from '@adapters'
import { useUi } from '../lib/store'

/** Right-hand dynamic context panel: AI insights, active-project status, actions. */
export function ContextPanel() {
  const { contextPanelOpen, activeProjectId } = useUi()
  const { data: insights } = usePortfolioInsights()
  const { data: projects } = useProjects()
  const project = projects?.find((p) => p.id === activeProjectId)

  if (!contextPanelOpen) return null

  return (
    <aside className="fixed right-0 top-16 z-20 hidden h-[calc(100%-4rem)] w-[320px] flex-col gap-md overflow-y-auto border-l border-outline-variant bg-surface-container-low p-md xl:flex custom-scrollbar">
      {/* AI Copilot */}
      <div className="rounded-xl bg-primary p-md text-white shadow-md">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="smart_toy" filled size={20} className="text-secondary-fixed" />
          <h3 className="text-headline-sm font-bold">AI Copilot</h3>
        </div>
        {insights?.slice(0, 1).map((i) => (
          <div key={i.id} className="rounded-lg border border-white/20 bg-white/10 p-3 text-body-sm backdrop-blur-sm">
            <p className="italic leading-relaxed">“{i.body}”</p>
            <p className="mt-2 text-on-primary/80">
              <span className="font-semibold text-secondary-fixed">Recommendation:</span> {i.recommendation}
            </p>
          </div>
        ))}
        <div className="mt-3 flex gap-2">
          <Button variant="accent" size="sm" className="flex-1">Create Action</Button>
          <Button size="sm" className="bg-white/10 hover:bg-white/20">Dismiss</Button>
        </div>
      </div>

      {/* Active project status */}
      {project && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
          <div className="mb-1 font-mono-tag text-label-sm uppercase text-on-surface-variant">Active Project</div>
          <div className="text-body-lg font-bold text-primary">{project.name}</div>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={project.health === 'critical' ? 'danger' : project.health === 'at-risk' ? 'warning' : 'success'}>
              {project.health === 'critical' ? 'Critical' : project.health === 'at-risk' ? 'At Risk' : 'Healthy'}
            </Badge>
            <span className="text-body-sm text-on-surface-variant">{project.phase}</span>
          </div>
          <Divider className="my-3" />
          <Stat label="Progress" value={`${project.progressPct}%`} />
          <Stat label="Budget" value={project.budgetStatus} />
          <Stat label="Schedule" value={project.scheduleStatus} />
          <Stat label="Quality" value={`${project.qualityPct}%`} />
        </div>
      )}

      {/* Related actions */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
        <div className="mb-2 font-mono-tag text-label-sm uppercase text-on-surface-variant">Requires Attention</div>
        <ul className="space-y-2 text-body-sm">
          {['Verify alt. turbine vendor', 'Close DEF-4821 calibration', 'Add electrical loop-check crew'].map((a) => (
            <li key={a} className="flex items-start gap-2">
              <Icon name="radio_button_unchecked" size={16} className="mt-0.5 text-on-surface-variant" />
              <span className="text-on-surface">{a}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('flex items-center justify-between py-1 text-body-sm')}>
      <span className="text-on-surface-variant">{label}</span>
      <span className="font-semibold text-primary">{value}</span>
    </div>
  )
}
