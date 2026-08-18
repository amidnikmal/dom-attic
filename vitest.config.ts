import { defineConfig } from 'vitest/config'

/**
 * Tests run in a real browser: the core works with detached DOM, focus and
 * synthetic clicks, and emulation is not faithful enough there.
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
