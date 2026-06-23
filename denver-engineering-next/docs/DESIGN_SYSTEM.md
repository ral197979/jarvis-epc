# Design System — Industrial Precision System

Derived 1:1 from the Google Stitch `DESIGN.md` so Stitch-generated markup maps
directly onto our Tailwind theme.

## Brand

Authoritative, systematic, blueprint-inspired. High information density, light-first,
minimal decoration. Bridges traditional industrial software and modern enterprise SaaS.

## Tokens (see `tailwind.config.js`)

- **Color** — `primary` `#091426` / `primary-container` `#1e293b` (deep navy),
  `secondary` `#0058be`, slate neutrals (`surface-*`, `outline-variant`).
  Status (inviolable): `success` `#16a34a`, `warning` `#f97316`,
  `danger` `#dc2626`, `info` `#3b82f6`, `error` `#ba1a1a`.
- **Type** — Inter (UI) + JetBrains Mono (technical IDs, labels, metrics).
  Scale: `display-lg`, `headline-md/sm`, `body-lg/md/sm`, `label-md/sm`.
- **Spacing** — 4px grid: `xs 4 · sm 8 · md 16 · lg 24 · xl 32`.
- **Radius** — soft: default `0.25rem`, cards `xl 0.75rem`.
- **Elevation** — tonal layering + 1px outlines over heavy shadows.

## Components (`@ds`)

`Button` · `Card` (+Header/Title/Body) · `Badge` / `StatusChip` · `KpiCard` ·
`Input` / `Label` / `Select` · `Progress` / `Gauge` · `Tabs` · `Dialog` ·
`Drawer` (slide-over) · `Avatar` · `Skeleton` · `SectionHeader` · `EmptyState` ·
`Divider` · `DataTable` (sortable, sticky header/first column, zebra) · `Icon`
(Material Symbols).

## Conventions

- **Status colour is semantic** — never hand-pick; use `StatusChip` (infers tone
  from label) or `Badge tone=…`. Lifecycle cells use `cellStatusMeta`.
- **Technical IDs** render in `font-mono-tag` (JetBrains Mono).
- **Tables** are the core surface: sticky headers, sticky ID column, 1px column
  separators, zebra striping, dense row height.
- **AI presence** uses the navy surface with the `smart_toy` sparkle icon.
- **Critical** states get a 4px left accent (`border-l-danger`).
