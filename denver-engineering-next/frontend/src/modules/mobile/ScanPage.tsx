import { useState } from 'react'
import { Card, Button, Badge, StatusChip, Progress, Icon, cn } from '@ds'
import { useEquipment } from '@adapters'

type Phase = 'idle' | 'scanning' | 'found' | 'audited'

export function ScanPage() {
  const { data: equipment = [] } = useEquipment()
  const [phase, setPhase] = useState<Phase>('idle')
  const asset = equipment.find((e) => e.tag === 'ELEC-SG-200') ?? equipment[0]

  const scan = () => {
    setPhase('scanning')
    setTimeout(() => setPhase('found'), 1300)
  }

  if (phase === 'audited' && asset) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/15 text-success"><Icon name="task_alt" filled size={48} /></div>
        <h2 className="text-headline-md font-bold text-primary">Asset Audited</h2>
        <p className="max-w-xs text-body-sm text-on-surface-variant"><span className="font-mono-tag">{asset.tag}</span> verified on site. The audit record is queued for sync.</p>
        <Button variant="accent" className="mt-2" onClick={() => setPhase('idle')}><Icon name="qr_code_scanner" size={18} /> Scan Next</Button>
      </div>
    )
  }

  return (
    <div className="space-y-md">
      {/* Scanner viewport */}
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-primary">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(#2170e4 1px,transparent 1px),linear-gradient(90deg,#2170e4 1px,transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={cn('relative h-44 w-44 rounded-lg border-2 border-secondary-fixed', phase === 'scanning' && 'animate-pulse')}>
            <span className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-lg border-l-4 border-t-4 border-secondary-fixed" />
            <span className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-lg border-r-4 border-t-4 border-secondary-fixed" />
            <span className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-lg border-b-4 border-l-4 border-secondary-fixed" />
            <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-lg border-b-4 border-r-4 border-secondary-fixed" />
            {phase === 'scanning' && <div className="absolute inset-x-0 top-0 h-0.5 animate-[slide-in-right_1.2s_ease-in-out_infinite] bg-secondary-fixed" />}
            <Icon name="qr_code_2" size={64} className="absolute inset-0 m-auto text-white/30" />
          </div>
        </div>
        <div className="absolute bottom-3 left-0 right-0 text-center text-body-sm text-on-primary/70">
          {phase === 'scanning' ? 'Reading QR / RFID…' : 'Align the asset tag within the frame'}
        </div>
      </div>

      {phase !== 'found' ? (
        <Button variant="accent" size="lg" className="w-full" disabled={phase === 'scanning'} onClick={scan}>
          <Icon name="qr_code_scanner" size={20} /> {phase === 'scanning' ? 'Scanning…' : 'Scan Asset'}
        </Button>
      ) : asset ? (
        <>
          <Card className="p-md">
            <div className="flex items-center justify-between">
              <span className="font-mono-tag text-label-md text-on-surface-variant">{asset.tag}</span>
              <StatusChip status={asset.status} dot />
            </div>
            <div className="mt-0.5 text-headline-sm font-bold text-primary">{asset.name}</div>
            <div className="mt-1 text-body-sm text-on-surface-variant">{asset.system} · {asset.vendor} {asset.model}</div>
            <div className="mb-1 mt-3 flex items-center justify-between text-body-sm">
              <span className="text-on-surface-variant">Completion</span><span className="font-mono-tag">{asset.completionPct}%</span>
            </div>
            <Progress value={asset.completionPct} threshold />
            {asset.openPunch > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-warning/15 p-2 text-body-sm text-warning">
                <Icon name="report" size={16} /> {asset.openPunch} open punch item(s) on this asset
              </div>
            )}
          </Card>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setPhase('idle')}><Icon name="close" size={18} /> Cancel</Button>
            <Button variant="accent" size="lg" onClick={() => setPhase('audited')}><Icon name="check" size={18} /> Confirm Audit</Button>
          </div>
          <Badge tone="info" dot className="w-full justify-center py-1.5">Match confidence 98% · RFID + QR</Badge>
        </>
      ) : null}
    </div>
  )
}
