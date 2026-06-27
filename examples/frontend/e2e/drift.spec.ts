import { type Page, expect, test } from '@playwright/test'

const GO = 'http://localhost:8080'

/** Reset the backend to its canonical (no-drift) shape before each test. */
test.beforeEach(async ({ request }) => {
  await request.post(`${GO}/api/_drift?mode=none`)
})

test.afterAll(async ({ request }) => {
  await request.post(`${GO}/api/_drift?mode=none`)
})

async function waitForBaseline(page: Page) {
  await expect(page.getByTestId('book-card').first()).toBeVisible()
  // schemind has observed at least the books list and learned a baseline.
  await expect(page.locator('[data-testid="drift-entry"]').first()).toBeVisible()
}

/** Switch the drift selector (a Radix Select: open the trigger, click the item). */
async function setDrift(page: Page, mode: string) {
  await page.getByTestId('drift-mode').click()
  await page.getByTestId(`drift-mode-${mode}`).click()
}

test.describe
  .serial('schemind demo — MVP shape-drift detection', () => {
    test('lists seeded books and learns a baseline', async ({ page }) => {
      await page.goto('/')
      await waitForBaseline(page)

      const count = await page.getByTestId('book-card').count()
      expect(count).toBeGreaterThanOrEqual(3)

      // The first observation of an endpoint is a baseline (no drift), not an alarm.
      await expect(
        page.locator('[data-testid="drift-entry"][data-severity="baseline"]').first(),
      ).toBeVisible()
    })

    test('flags a BREAKING change when the backend renames a field', async ({ page }) => {
      await page.goto('/')
      await waitForBaseline(page)

      await setDrift(page, 'breaking')

      const breaking = page.locator('[data-testid="drift-entry"][data-severity="breaking"]').first()
      await expect(breaking).toBeVisible()
      // The renamed `author` field shows up as a detected change.
      await expect(
        breaking.getByTestId('drift-change').filter({ hasText: 'author' }).first(),
      ).toBeVisible()
      await expect(breaking.getByTestId('drift-severity')).toHaveText(/breaking/i)
    })

    test('flags a WARN change when a field becomes nullable', async ({ page }) => {
      await page.goto('/')
      await waitForBaseline(page)

      await setDrift(page, 'warn')

      const warn = page.locator('[data-testid="drift-entry"][data-severity="warn"]').first()
      await expect(warn).toBeVisible()
      await expect(
        warn.getByTestId('drift-change').filter({ hasText: 'rating' }).first(),
      ).toBeVisible()
    })

    test('flags an INFO change when a field is added', async ({ page }) => {
      await page.goto('/')
      await waitForBaseline(page)

      await setDrift(page, 'info')

      const info = page.locator('[data-testid="drift-entry"][data-severity="info"]').first()
      await expect(info).toBeVisible()
      await expect(
        info.getByTestId('drift-change').filter({ hasText: 'genre' }).first(),
      ).toBeVisible()
    })

    test('creates a book through the UI', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByTestId('book-card').first()).toBeVisible()

      const title = `Domain-Driven Design ${Date.now()}`
      await page.getByTestId('add-book').click()
      await expect(page.getByTestId('book-form')).toBeVisible()
      await page.getByTestId('field-title').fill(title)
      await page.getByTestId('field-author').fill('Eric Evans')
      await page.getByTestId('submit-book').click()

      await expect(page.getByTestId('book-form')).toBeHidden()
      await expect(page.getByText(title)).toBeVisible()
    })
  })
