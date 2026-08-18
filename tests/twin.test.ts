import { afterEach, describe, expect, it } from 'vitest'

import { createSnapshot, nodeByPath, pathTo } from '../src/core/index'
import { cleanup, createCell } from './helpers'

afterEach(cleanup)

describe('twin', () => {
  it('находит тот же узел в структурно идентичной копии', () => {
    const { live } = createCell()
    const clone = createSnapshot(live)
    const button = clone.querySelector('button')!

    const path = pathTo(clone, button)
    expect(path).not.toBeNull()

    expect(nodeByPath(live, path!)).toBe(live.querySelector('button'))
  })

  it('возвращает null, если узел вне поддерева', () => {
    const { live } = createCell()

    expect(pathTo(live, document.body)).toBeNull()
  })
})
