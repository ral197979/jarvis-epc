/**
 * Denver Engineering — E2E: demonstration data is opt-in
 * ─────────────────────────────────────────────────────────────────────────────
 * Run against the production build (npm run build && npm run preview).
 *
 * The app used to boot from the Lusaka WTP / Maputo PM sample. JarvisCore
 * initialised its `biz` state from DEFAULT_BIZ_STATE and every store-backed
 * view rendered it, and nothing in that path consults a domain API — `biz` is
 * replaced only by a persisted blob or a user's backup file. So a brand new
 * user was shown a $425,000 active contract for "US DOS", $63,750 of invoices
 * and two open safety incidents in exactly the styling real figures use.
 *
 * These are the two states that matter, and the unit tests cannot cover them:
 * they exercise `getInitialBizState()` in isolation, whereas this asserts what
 * a real browser loading the real bundle actually puts on screen.
 *
 *   1. FRESH   — no opt-in, nothing persisted: no sample figures, no banner.
 *   2. DEMO    — ?demo=1: the sample loads AND is disclosed as a sample.
 *
 * Every test starts from a genuinely clean origin. `?demo=1` writes a
 * localStorage opt-in that deliberately outlives the query string, so a leaked
 * one would silently turn case 1 into case 2 and the suite would still pass.
 */
import { test, expect, Page } from '@playwright/test'

/** Values that exist only in the shipped sample. */
const SAMPLE_TRACES = ['Lusaka', 'Maputo', 'US DOS']

/**
 * A screen that actually RENDERS the sample's rows.
 *
 * The landing tab is `focus`, which shows none of them — the banner appears
 * there but the figures do not. `?tab=` cannot be used to get elsewhere either:
 * JarvisCore deliberately forces the Focus tab on login ("W1: login lands on
 * Focus, not Dashboard"), so a deep link is overridden. Navigation therefore
 * goes through the sidebar, the way a user would.
 */
const DATA_TAB_LABEL = 'Dashboard'

/** Click through to a screen by its sidebar label. */
async function goToTab(page: Page, label: string): Promise<void> {
  const nav = page.getByRole('navigation')
  await nav.getByRole('button', { name: label, exact: false }).first().click()
  await page.waitForTimeout(1_000)
}

const BANNER = /Demonstration data/i

/**
 * The build's own default unlock PIN, printed on the login screen itself
 * ("Default PIN: 0000"). It is fixture data for a local preview build, not a
 * credential — but it lives in one place and reads from the environment so a
 * build configured differently can be tested without editing this file.
 */
const PIN = process.env.E2E_PIN ?? '0000'

/**
 * Get past the PIN gate.
 *
 * Without this every assertion below would run against the LOGIN screen, where
 * "no Lusaka anywhere" is trivially true — the fresh-session tests would pass
 * for entirely the wrong reason. That is what the non-vacuity test at the
 * bottom of this file exists to catch, and it did.
 */
async function unlock(page: Page): Promise<void> {
  const pinBox = page.getByRole('textbox', { name: /PIN/i })
  if (!(await pinBox.isVisible().catch(() => false))) return   // already unlocked
  await pinBox.fill(PIN)
  const unlockBtn = page.getByRole('button', { name: /Unlock/i })
  await unlockBtn.click()
  await pinBox.waitFor({ state: 'detached', timeout: 15_000 })
}

/**
 * Load the app at `path` from a clean origin.
 *
 * The storage wipe has to happen ON the origin, so we land once, clear, then
 * navigate for real — otherwise the first paint has already read whatever a
 * previous test left behind.
 */
async function freshVisit(page: Page, path = '/'): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.goto(path)
  await page.locator('#root').waitFor({ state: 'attached', timeout: 15_000 })
  await unlock(page)
  // Let the store initialiser and the persistence effect settle.
  await page.waitForTimeout(1_500)
}

const bodyText = (page: Page): Promise<string> => page.locator('body').innerText()

// ─── 1. A fresh session shows nothing that is not the user's ─────────────────

test.describe('fresh session — empty by default', () => {
  test('the suite is actually past the login gate', async ({ page }) => {
    // Guard for every assertion in this file. The PIN screen shows none of the
    // sample values, so a suite stuck on it would report a clean fresh session
    // while proving nothing at all.
    await freshVisit(page)
    await expect(page.getByRole('textbox', { name: /PIN/i })).toHaveCount(0)
  })

  test('shows no sample project anywhere on the page', async ({ page }) => {
    await freshVisit(page)
    await goToTab(page, DATA_TAB_LABEL)
    const text = await bodyText(page)
    for (const trace of SAMPLE_TRACES) {
      expect(text, `fresh session must not show "${trace}"`).not.toContain(trace)
    }
  })

  test('shows no demonstration-data banner, because there is no demo data', async ({ page }) => {
    await freshVisit(page)
    await expect(page.getByText(BANNER)).toHaveCount(0)
  })

  test('does not write a demo opt-in of its own accord', async ({ page }) => {
    await freshVisit(page)
    const optIn = await page.evaluate(() => localStorage.getItem('jarvis:demo_data'))
    expect(optIn).toBeNull()
  })

  test('renders the shell rather than failing on an empty store', async ({ page }) => {
    // The real risk of emptying the boot state is `undefined.length` inside a
    // view. A blank page would pass a "no Lusaka" check while being broken.
    await freshVisit(page)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.waitForTimeout(500)
    await expect(page.locator('#root')).not.toBeEmpty()
    expect(errors, 'no uncaught errors on an empty store').toEqual([])
  })
})

// ─── 2. Opt-in loads the sample, and says that it is one ─────────────────────

test.describe('?demo=1 — sample loaded and disclosed', () => {
  test('loads the sample project', async ({ page }) => {
    await freshVisit(page, '/?demo=1')
    await goToTab(page, DATA_TAB_LABEL)
    const text = await bodyText(page)
    const found = SAMPLE_TRACES.filter(t => text.includes(t))
    expect(found.length, `expected sample traces, saw: ${found.join(', ') || 'none'}`).toBeGreaterThan(0)
  })

  test('discloses it as demonstration data', async ({ page }) => {
    await freshVisit(page, '/?demo=1')
    await expect(page.getByText(BANNER).first()).toBeVisible()
  })

  test('remembers the opt-in after the query string is gone', async ({ page }) => {
    await freshVisit(page, '/?demo=1')
    await page.goto('/')                       // same origin, no param
    await unlock(page)
    await page.waitForTimeout(1_500)
    await expect(page.getByText(BANNER).first()).toBeVisible()
  })

  test('?demo=0 turns it back off and clears the opt-in', async ({ page }) => {
    await freshVisit(page, '/?demo=1')
    await page.goto('/?demo=0')
    await unlock(page)
    await page.waitForTimeout(1_500)
    await expect(page.getByText(BANNER)).toHaveCount(0)
    const optIn = await page.evaluate(() => localStorage.getItem('jarvis:demo_data'))
    expect(optIn).toBeNull()
  })
})

// ─── 3. The two states are genuinely different ───────────────────────────────

test.describe('the fresh and demo states are not the same page', () => {
  test('demo shows strictly more than fresh', async ({ page }) => {
    // Non-vacuity for the whole file: if the sample never loaded under ?demo=1
    // then every "fresh session has no Lusaka" assertion above would pass for
    // the wrong reason.
    await freshVisit(page)
    await goToTab(page, DATA_TAB_LABEL)
    const fresh = await bodyText(page)
    await freshVisit(page, '/?demo=1')
    await goToTab(page, DATA_TAB_LABEL)
    const demo = await bodyText(page)

    const freshHits = SAMPLE_TRACES.filter(t => fresh.includes(t)).length
    const demoHits  = SAMPLE_TRACES.filter(t => demo.includes(t)).length
    expect(freshHits).toBe(0)
    expect(demoHits).toBeGreaterThan(0)
  })
})
