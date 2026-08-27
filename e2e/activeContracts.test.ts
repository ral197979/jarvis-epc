/**
 * Denver Engineering — E2E: Active Contracts counts only governed contracts
 * ─────────────────────────────────────────────────────────────────────────────
 * The acceptance criterion:
 *
 *   the Active Contracts KPI represents only genuine persisted contracts whose
 *   actual lifecycle state satisfies the repository's governed definition of
 *   active.
 *
 * The audit behind it: `contracts` (migration 002) carries `vendor_id NOT NULL`
 * — a contract is a commitment to a VENDOR, delivered on a project. A project
 * is not one. The tile previously counted `biz.contracts`, a store array with a
 * free-text status that is not the persisted `contract_status` enum, and the
 * Hub's neighbouring tile had counted projects outright.
 *
 * Unit tests prove the service counts `status = 'active'` and that the card
 * reads the API. They cannot prove the assembled application does, because the
 * defect was a component counting for itself. So this drives the production
 * bundle in a real browser.
 *
 * The preview build has no API behind it, so `/api/v1/contracts/summary` cannot
 * answer — which is the point. An unreachable endpoint must leave the card
 * blank, never fall back to whatever is in the snapshot.
 */
import { test, expect, Page } from '@playwright/test'

const PIN = process.env.E2E_PIN ?? '0000'

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

async function contractsCard(page: Page): Promise<string> {
  const card = page.getByRole('group', { name: 'Active Contracts' })
  await card.waitFor({ timeout: 15_000 })
  return (await card.innerText()).trim()
}

test.describe('a fresh session shows no contract count it cannot justify', () => {
  test('the card renders and shows no number', async ({ page }) => {
    await openDashboard(page)
    const text = await contractsCard(page)
    expect(text.toUpperCase()).toContain('ACTIVE CONTRACTS')
    expect(text).toContain('—')
    expect(text, `a count appeared: ${text}`).not.toMatch(/\b[1-9]\d*\b/)
  })
})

test.describe('the demo sample cannot become a contract count', () => {
  test('?demo=1 loads sample contracts, and the KPI still shows none', async ({ page }) => {
    // The sample ships contracts with status "active" — C-001 Lusaka WTP, and a
    // second — in `biz.contracts`. That is precisely the array the tile used to
    // count. If any fallback survives, this is where it shows.
    await openDashboard(page, '/?demo=1')
    const text = await contractsCard(page)
    expect(text, `the sample was counted: ${text}`).not.toMatch(/\b[1-9]\d*\b/)
    expect(text).toContain('—')
  })

  test('the sample really did load, so the check above means something', async ({ page }) => {
    // Non-vacuity: the snapshot IS present and IS rendered elsewhere on the
    // page, so "no count" is about the KPI's source, not about missing data.
    await openDashboard(page, '/?demo=1')
    await expect(page.getByText(/Demonstration data/i).first()).toBeVisible()
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/Lusaka|Maputo|US DOS/)
  })

  test('sample rows appear only under a panel that says they are a snapshot', async ({ page }) => {
    // They are not hidden — they are labelled, so they cannot be mistaken for
    // the governed count directly above them.
    await openDashboard(page, '/?demo=1')
    const body = await page.locator('body').innerText()
    if (/Lusaka WTP/.test(body)) {
      expect(body).toMatch(/Contracts \(loaded snapshot\)/i)
    }
  })
})

test.describe('a project is never counted as a contract', () => {
  test('the KPI does not borrow the projects count', async ({ page }) => {
    // Under demo the sample carries projects AND contracts. Neither may reach
    // this card: its only source is GET /api/v1/contracts/summary, which the
    // preview build cannot answer.
    const requested: string[] = []
    await page.route('**/api/v1/**', route => {
      requested.push(route.request().url())
      return route.continue()
    })
    await openDashboard(page, '/?demo=1')
    const text = await contractsCard(page)
    expect(text).toContain('—')

    const contractCalls = requested.filter(u => u.includes('/contracts/summary'))
    expect(contractCalls.length, 'the KPI must ask the contracts endpoint').toBeGreaterThan(0)
  })
})
