import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('cells mount once and go straight to storage', async ({ page }) => {
  await expect(page.getByTestId('stats')).toContainText('registered: 30')
  await expect(page.getByTestId('stats')).toContainText('live: 0')
})

test('the first click on a snapshot works', async ({ page }) => {
  const cell = page.getByTestId('cell-cell-0')

  await cell.getByTestId('inc').click()

  await expect(cell.getByTestId('local')).toHaveText('1')
})

test('state survives eviction from the document', async ({ page }) => {
  const first = page.getByTestId('cell-cell-0')

  await first.getByTestId('inc').click()
  await first.getByTestId('inc').click()
  await expect(first.getByTestId('local')).toHaveText('2')

  // liveLimit = 2, so three other cells push the first one back into storage.
  for (const idx of [1, 2, 3]) {
    await page.getByTestId(`cell-cell-${idx}`).getByTestId('inc').click()
  }

  // The snapshot shows the accumulated value...
  await expect(first.getByTestId('local')).toHaveText('2')

  // ...and the live component continues from it, not from zero.
  await first.getByTestId('inc').click()
  await expect(first.getByTestId('local')).toHaveText('3')
})

test('external data reaches the snapshots', async ({ page }) => {
  await page.getByTestId('bump').click()

  await expect(page.getByTestId('cell-cell-10').getByTestId('model')).toHaveText('1')
})
