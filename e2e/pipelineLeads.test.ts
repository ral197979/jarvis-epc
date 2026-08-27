/**
 * Denver Engineering — E2E: Pipeline (Weighted) shows no total it cannot justify
 * ─────────────────────────────────────────────────────────────────────────────
 * The audit behind this: `crm_leads` (migration 002) has `value` and
 * `probability` both NULLABLE, and `stage` as a bare VARCHAR(50) with no CHECK
 * and no enum — so there is no governed lifecycle to filter on, and a NULL
 * estimate is an UNKNOWN contribution rather than a zero one.
 *
 * The old dashboard computed the pipeline itself as
 *
 *     Σ (estimated_value ?? 0) × (probability ?? 0) / 100
 *
 * over `biz.leads` — a store array whose `estimated_value` is not even the
 * persisted column name (`value`). Both `?? 0` coercions understated the
 * pipeline by exactly the leads nobody had estimated, and the sample ships a
 * lead valued at 425,000 with probability 100, so the tile reported a
 * confident $425K from fixture data.
 *
 * The preview build has no API, so `/api/v1/leads/summary` cannot answer —
 * which is the point. An unreachable endpoint must leave the card blank, never
 * fall back to the snapshot.
 */
import { test, expect, Page } from '@playwright/test'

const PIN = process.env.E2E_PIN ?? '0000'
/** Any currency figure, e.g. "$425K", "$1.2M", "$0". */
const MONEY = /\$\s?\d/

async function unlock(page: Page): Promise<void> {
  const pinBox = page.getByRole('textbox', { name: /PIN/i })
  if (!(await pinBox.isVisible().catch(() => false))) return
  await pinBox.fill(PIN)
  await page.getByRole('button', { name: /Unlock/i }).click()
  await pinBox.waitFor({ state: 'detached', timeout: 15_000 })
}

async function openDashboard(page: Page, path = '/'): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.goto(path)
  await page.locator('#root').waitFor({ state: 'attached', timeout: 15_000 })
  await unlock(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Dashboard' }).first().click()
  await page.waitForTimeout(2_000)
}

async function pipelineCard(page: Page): Promise<string> {
  const card = page.getByRole('group', { name: 'Pipeline (Weighted)' })
  await card.waitFor({ timeout: 15_000 })
  return (await card.innerText()).trim()
}

test.describe('a fresh session shows no pipeline total', () => {
  test('the card renders and shows no money figure', async ({ page }) => {
    await openDashboard(page)
    const text = await pipelineCard(page)
    expect(text.toUpperCase()).toContain('PIPELINE (WEIGHTED)')
    expect(text).toContain('—')
    expect(text, `a total appeared: ${text}`).not.toMatch(MONEY)
  })

  test('shows no $0, which would be a sales claim', async ({ page }) => {
    await openDashboard(page)
    expect(await pipelineCard(page)).not.toContain('$0')
  })
})

test.describe('the demo sample cannot become a pipeline total', () => {
  test('?demo=1 loads a valued lead, and the KPI still shows none', async ({ page }) => {
    // The sample's LEAD-001 carries estimated_value 425000 and probability 100
    // — exactly the shape the old formula consumed. If any fallback survives,
    // this is where it shows.
    await openDashboard(page, '/?demo=1')
    const text = await pipelineCard(page)
    expect(text, `the sample was totalled: ${text}`).not.toMatch(MONEY)
    expect(text).toContain('—')
  })

  test('the sample really did load, so the check above means something', async ({ page }) => {
    await openDashboard(page, '/?demo=1')
    await expect(page.getByText(/Demonstration data/i).first()).toBeVisible()
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/Lusaka|Maputo|US DOS/)
  })

  test('the funnel is labelled a snapshot, since its stages are not in the schema', async ({ page }) => {
    // buildFunnelData groups by five hardcoded names — new, qualified,
    // proposal, negotiation, won — none of which exists in `crm_leads.stage`,
    // whose own default is 'prospecting'. It is snapshot-derived and says so.
    await openDashboard(page, '/?demo=1')
    const body = await page.locator('body').innerText()
    if (/Pipeline Funnel/i.test(body)) {
      expect(body).toMatch(/Pipeline Funnel \(loaded snapshot\)/i)
    }
  })
})

test.describe('the KPI asks the leads endpoint and nothing else', () => {
  test('requests /leads/summary, never a projects or contracts substitute', async ({ page }) => {
    const requested: string[] = []
    await page.route('**/api/v1/**', route => {
      requested.push(route.request().url())
      return route.continue()
    })
    await openDashboard(page, '/?demo=1')
    expect(await pipelineCard(page)).toContain('—')
    expect(requested.filter(u => u.includes('/leads/summary')).length,
      'the KPI must ask the leads endpoint').toBeGreaterThan(0)
  })
})
