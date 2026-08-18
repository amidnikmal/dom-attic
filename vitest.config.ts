import { defineConfig } from 'vitest/config'

/**
 * Тесты гоняются в настоящем браузере: ядро работает с detached DOM,
 * фокусом и синтетическими кликами — эмуляции здесь недостаточно.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
})
