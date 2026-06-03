import { test, expect } from '@playwright/test'

test.describe('Dashboard Sessions Table', () => {
  test('sessions page loads and shows table', async ({ page }) => {
    await page.goto('/sessions')
    await expect(page.locator('[data-testid="sessions-table"]')).toBeVisible()
  })

  test('deleted session row has visual indicator', async ({ page }) => {
    await page.goto('/sessions')
    const deletedRow = page.locator('[data-testid="session-row-deleted"]').first()
    if (await deletedRow.isVisible()) {
      await expect(deletedRow).toHaveClass(/deleted/)
    }
  })
})
