import { Icon, Card } from '@ds'

/** Default-friendly wrapper used as the lazy 404 route element. */
export function NotFoundPlaceholder() {
  return <ModulePlaceholder title="Not Found" icon="error" description="This route does not exist yet." />
}

/** Styled placeholder for Phase ≥ 2 modules — keeps the IA navigable end-to-end. */
export function ModulePlaceholder({
  title,
  icon,
  description,
  features = [],
}: {
  title: string
  icon: string
  description: string
  features?: string[]
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card className="p-xl">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-on-primary">
            <Icon name={icon} size={28} />
          </div>
          <div>
            <h1 className="text-headline-md font-bold text-primary">{title}</h1>
            <p className="mt-1 text-body-md text-on-surface-variant">{description}</p>
          </div>
        </div>

        {features.length > 0 && (
          <div className="mt-lg">
            <div className="mb-3 font-mono-tag text-label-md uppercase text-on-surface-variant">Planned capabilities</div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {features.map((f) => (
                <li key={f} className="flex items-center gap-2 rounded-lg border border-outline-variant bg-background px-3 py-2.5 text-body-sm">
                  <Icon name="check_circle" size={18} className="text-secondary" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-lg rounded-lg bg-surface-container-low p-4 text-body-sm text-on-surface-variant">
          <Icon name="bolt" size={16} className="mr-1 align-text-bottom text-secondary" />
          This module is on the migration roadmap. The shell, design system, and adapter layer are
          ready — wiring its screens is a Phase 2+ task.
        </div>
      </Card>
    </div>
  )
}
