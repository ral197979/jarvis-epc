import { useEffect, useMemo, useState } from 'react'
import {
  Card,
  Badge,
  StatusChip,
  Button,
  Icon,
  Gauge,
  Progress,
  cn,
  EmptyState,
} from '@ds'
import { useTwinAssets, type TwinAsset, type TwinTelemetry } from '@adapters'
import { PageHeader } from '../../components/shared'

export function DigitalTwinPage() {
  const { data = [] } = useTwinAssets()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId && data.length) setSelectedId(data[0].id)
  }, [data, selectedId])

  const selected = data.find((a) => a.id === selectedId)
  const systems = useMemo(() => Array.from(new Set(data.map((a) => a.system))), [data])

  return (
    <div>
      <PageHeader title="Digital Twin" subtitle="Asset registry · live telemetry · completion overlays" />
      <div className="grid grid-cols-12 gap-lg">
        {/* Asset hierarchy */}
        <Card className="col-span-12 overflow-hidden lg:col-span-3">
          <div className="border-b border-outline-variant p-md font-mono-tag text-label-md uppercase text-on-surface-variant">Asset Hierarchy</div>
          <div className="p-2">
            {systems.map((sys) => (
              <div key={sys} className="mb-2">
                <div className="flex items-center gap-1 px-2 py-1 font-mono-tag text-label-md uppercase text-primary">
                  <Icon name="account_tree" size={16} /> {sys}
                </div>
                {data.filter((a) => a.system === sys).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm transition-colors',
                      a.id === selectedId ? 'bg-secondary text-on-secondary' : 'hover:bg-surface-container-low',
                    )}
                  >
                    <span className={cn('h-2 w-2 rounded-full', statusDot(a.status))} />
                    <span className="flex-1 font-mono-tag">{a.tag}</span>
                    <span className={cn('text-label-sm', a.id === selectedId ? 'text-on-secondary/80' : 'text-on-surface-variant')}>{a.completionPct}%</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>

        {/* Twin viewer */}
        <div className="col-span-12 space-y-lg lg:col-span-6">
          {!selected ? (
            <Card><EmptyState icon="view_in_ar" title="Select an asset" description="Choose an asset to view its digital twin." /></Card>
          ) : (
            <TwinViewer asset={selected} />
          )}
        </div>

        {/* Live telemetry */}
        <div className="col-span-12 lg:col-span-3">
          {selected && <LiveTelemetry asset={selected} />}
        </div>
      </div>
    </div>
  )
}

function TwinViewer({ asset }: { asset: TwinAsset }) {
  return (
    <>
      <Card className="overflow-hidden">
        <div className="relative h-[300px] bg-primary">
          {/* blueprint grid */}
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(#2170e4 1px,transparent 1px),linear-gradient(90deg,#2170e4 1px,transparent 1px)', backgroundSize: '28px 28px' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon name="deployed_code" size={140} className="text-secondary-fixed/40" />
          </div>
          {/* overlays */}
          <div className="absolute left-4 top-4 rounded-lg border border-white/20 bg-white/10 p-3 backdrop-blur-md">
            <div className="font-mono-tag text-label-sm uppercase text-secondary-fixed">{asset.tag}</div>
            <div className="text-body-lg font-bold text-white">{asset.name}</div>
            <div className="mt-1"><StatusChip status={asset.status} dot /></div>
          </div>
          <div className="absolute bottom-4 right-4 rounded-lg border border-white/20 bg-white/10 p-2 backdrop-blur-md">
            <Gauge value={asset.completionPct} size={88} label="Complete" />
          </div>
        </div>
        <div className="flex items-center justify-between p-md">
          <div className="flex gap-2">
            <Button variant="accent" size="sm"><Icon name="play_circle" size={18} /> Initiate PFC</Button>
            <Button variant="secondary" size="sm"><Icon name="report" size={18} /> Log Deficiency</Button>
          </div>
          <Button variant="ghost" size="sm"><Icon name="hub" size={18} /> Navigate to BIM</Button>
        </div>
      </Card>

      <Card className="p-lg">
        <h3 className="mb-md text-headline-sm font-bold text-primary">Asset Status</h3>
        <div className="mb-1 flex items-center justify-between text-body-sm"><span className="text-on-surface-variant">Completion</span><span className="font-semibold text-primary">{asset.completionPct}%</span></div>
        <Progress value={asset.completionPct} threshold height={10} />
        <div className="mt-md grid grid-cols-3 gap-3 border-t border-outline-variant pt-md text-center">
          <Meta label="System" value={asset.system} />
          <Meta label="Open Punch" value={String(asset.openPunch)} />
          <Meta label="Status" value={asset.status} />
        </div>
      </Card>
    </>
  )
}

/** Simulated live telemetry stream — jitters each value within range every 2s. */
function LiveTelemetry({ asset }: { asset: TwinAsset }) {
  const [values, setValues] = useState<TwinTelemetry[]>(asset.telemetry)

  useEffect(() => {
    setValues(asset.telemetry)
    if (asset.status === 'Offline') return
    const id = setInterval(() => {
      setValues((prev) =>
        prev.map((t) => {
          const span = (t.max - t.min) * 0.015
          const next = t.value + (((asset.id.charCodeAt(0) + Date.now() / 1000) % 2) - 1) * span * (1 + (t.label.length % 3))
          const clamped = Math.max(t.min, Math.min(t.max, next))
          return { ...t, value: Math.round(clamped * 10) / 10 }
        }),
      )
    }, 2000)
    return () => clearInterval(id)
  }, [asset])

  return (
    <Card className="p-lg">
      <div className="mb-md flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', asset.status === 'Offline' ? 'bg-status-gray' : 'bg-success animate-pulse')} />
        <h3 className="text-headline-sm font-bold text-primary">Live Telemetry</h3>
      </div>
      {asset.status === 'Offline' ? (
        <p className="text-body-sm text-on-surface-variant">Asset offline — no live signal.</p>
      ) : (
        <div className="space-y-md">
          {values.map((t) => {
            const pct = ((t.value - t.min) / (t.max - t.min)) * 100
            return (
              <div key={t.label}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-body-sm text-on-surface-variant">{t.label}</span>
                  <span className="font-mono-tag text-body-md font-semibold text-primary">{t.value} <span className="text-label-md text-on-surface-variant">{t.unit}</span></span>
                </div>
                <Progress value={pct} threshold />
              </div>
            )
          })}
          <Badge tone="info" dot className="mt-2">Streaming · 2s interval</Badge>
        </div>
      )}
    </Card>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono-tag text-label-sm uppercase text-on-surface-variant">{label}</div>
      <div className="mt-0.5 text-body-sm font-semibold text-primary">{value}</div>
    </div>
  )
}

function statusDot(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('operational')) return 'bg-success'
  if (s.includes('testing')) return 'bg-info'
  if (s.includes('offline')) return 'bg-status-gray'
  return 'bg-warning'
}
