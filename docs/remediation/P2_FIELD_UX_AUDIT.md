# P2 — Field UX Audit Findings

**Gap class:** PARITY → LEAD
**Release slot:** v4.32.0 (absorbed into G1 mobile work)
**Competitive reference:** Procore's field-side ergonomics
**Status:** DRAFT — awaiting owner approval

---

## Target end-state

Three field-facing views (`DailyLogsView`, `ActionItemsView`, `FieldOperationsView`) ship with field-first ergonomics that match Procore on the dimensions field workers actually care about:

- One-tap entry
- Large touch targets
- Photo-first layout
- Voice-to-text optional
- Sticky submit that's impossible to miss
- Works while wearing gloves (tested in cold-weather pilot)

---

## Audit method

This is a design-system audit, not a user-research study. Findings below were derived from:

1. Reading the three component files in the v4.30.0 repo
2. Comparing against published Procore mobile UX patterns
3. Applying WCAG 2.1 AA + touch-target guidelines (44×44 px minimum)
4. Project's existing `jarvis-*` CSS token set in `src/styles/tokens.css` / `utilities.css`

A full user-research pass with 2 field pilots is recommended before v4.32.0 RC — not required to start implementation.

---

## Current issues (shared across all three views)

| # | Issue | Impact | Evidence in repo |
|---|---|---|---|
| UX-01 | Desktop-first form layout — multi-column with small inputs | Slow entry on phone | Inputs use default desktop sizing; no mobile breakpoint |
| UX-02 | Tap targets below 44×44 px for action buttons | Mis-taps under gloves | `.jarvis-btn` default is 36 px tall |
| UX-03 | Photo attach is buried behind secondary menu | Underused; daily logs lack evidence | Attach button in card footer only |
| UX-04 | Submit button scrolls off-screen on long forms | Users abandon after typing | No sticky submit |
| UX-05 | No haptic feedback on successful submit | Unclear completion | No haptics integration |
| UX-06 | Voice-to-text not wired | Field input friction | No binding to Web Speech API or native |
| UX-07 | Timestamp/geo capture is manual | Friction; unreliable data | No auto-capture on entry |
| UX-08 | Modal-style entry blocks context | User loses project context | Full-screen modal used instead of bottom sheet |
| UX-09 | Dark mode inconsistent on capture screens | Eye strain in low light | Some inline styles don't use tokens |

---

## Per-view recommendations

### `DailyLogsView.tsx`

| Change | Pattern | Token usage |
|---|---|---|
| Convert entry form to bottom sheet (65% viewport height) | Sheet-style | `--jarvis-surface-elevated`, `--jarvis-radius-lg` |
| Photo-first layout: camera button is primary action, top of sheet, 72 px tall | `jarvis-btn-primary` + size override | `--jarvis-accent`, `--jarvis-on-accent` |
| Sticky submit bar at bottom of sheet (not scrollable) | Fixed position inside sheet | `--jarvis-surface` + `--jarvis-border` |
| Auto-capture geo + timestamp on sheet open; user can edit | Capacitor `@capacitor/geolocation` | — |
| Voice-to-text button inside notes field; tap to dictate | Web Speech API (PWA) + native SR (Capacitor) | — |

### `ActionItemsView.tsx`

| Change | Pattern |
|---|---|
| Swipe-right-to-complete on each card | Gesture via Framer Motion or plain touch handlers |
| Swipe-left-to-defer → bottom-sheet deferral dialog | — |
| Bulk complete via long-press multi-select (already present? verify) | — |
| Collapse metadata panel by default; expand on tap | — |
| Photo attach inline when adding a note | `@capacitor/camera` |

### `FieldOperationsView.tsx`

| Change | Pattern |
|---|---|
| Safety observation entry: single-field first screen ("What did you see?"), then structured fields on next step | Progressive disclosure |
| Severity selector as large chip row (Low / Med / High / Critical) — 56 px tall, one-tap | `jarvis-chip` with size override |
| Category auto-suggested based on prior observations | Optional — v2 |
| Photo capture is required for High/Critical | Validation rule surfaced pre-submit |

---

## Haptics + confirmation

On successful submission:

- Capacitor `Haptics.notification({ type: 'SUCCESS' })`
- 200ms green border pulse on the view
- Toast: "Daily log saved · Synced" (or "Queued for sync" if offline)
- Optional sound (user preference off by default)

---

## Accessibility gate

Every changed surface must maintain:

- axe-core WCAG 2.1 AA: zero violations (existing `jest-axe` infra)
- Minimum 44×44 px touch targets — verified by automated test
- Color contrast ≥ 4.5:1 on all text; ≥ 3:1 on large text
- `aria-label` on every icon-only button
- Focus visible ring ≥ 3:1 contrast against adjacent background

---

## Before/after mockup guide

Mockups are delivered via Figma (file to be created in the Denver Engineering Figma workspace, not embedded here). Link to be added once designer is assigned. In the interim, engineer implementing the changes should reference this doc as the spec.

---

## Acceptance criteria

- [ ] All three views pass the audit criteria above
- [ ] Tap-target automated test: `__tests__/axe/touch-targets.test.tsx` green
- [ ] Haptics success feedback works on Capacitor iOS + Android; is a no-op on desktop PWA without degrading UX
- [ ] Photo-first entry tested with 10 captures / attachments on physical iOS + Android device
- [ ] Voice-to-text works on Chrome/Safari mobile (Web Speech API) and Capacitor native (SR plugin)
- [ ] Pilot-user feedback from ≥ 2 field users recorded before v4.32.0 GA
- [ ] `CHANGELOG.md` v4.32.0 entry

---

## Effort estimate

Absorbed into G1 mobile work. Net-new UX effort: **~3 days** (1 day per view).

---

## Owner approval

- [ ] **Approved** — proceed; absorb into G1 mobile sprint
- [ ] **Approved with adjustments:** __________
- [ ] **Rejected** — reason: __________
- [ ] **Deferred** — re-review at date: ______________

Signed: _________________________  Date: _______________
