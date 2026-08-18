import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('ячейки монтируются один раз и сразу уходят в хранилище', async ({ page }) => {
  await expect(page.getByTestId('stats')).toContainText('registered: 30')
  await expect(page.getByTestId('stats')).toContainText('live: 0')
})

test('первый клик по снимку срабатывает', async ({ page }) => {
  const cell = page.getByTestId('cell-cell-0')

  await cell.getByTestId('inc').click()

  await expect(cell.getByTestId('local')).toHaveText('1')
})

test('состояние переживает вытеснение из документа', async ({ page }) => {
  const first = page.getByTestId('cell-cell-0')

  await first.getByTestId('inc').click()
  await first.getByTestId('inc').click()
  await expect(first.getByTestId('local')).toHaveText('2')

  // liveLimit = 2, поэтому три других ячейки вытеснят первую в хранилище.
  for (const idx of [1, 2, 3]) {
    await page.getByTestId(`cell-cell-${idx}`).getByTestId('inc').click()
  }

  // Снимок показывает накрученное значение...
  await expect(first.getByTestId('local')).toHaveText('2')

  // ...и живой компонент продолжает с него же, а не с нуля.
  await first.getByTestId('inc').click()
  await expect(first.getByTestId('local')).toHaveText('3')
})

test('внешние данные доезжают до снимков', async ({ page }) => {
  await page.getByTestId('bump').click()

  await expect(page.getByTestId('cell-cell-10').getByTestId('model')).toHaveText('1')
})
