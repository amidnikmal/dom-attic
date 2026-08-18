import { afterEach, describe, expect, it } from 'vitest'

import { createSnapshot, nodeByPath, pathTo } from '../src/core/index'
import { cleanup, createCell } from './helpers'

afterEach(cleanup)

describe('twin', () => {
  it('finds the same node in a structurally identical copy', () => {
    const { live } = createCell()
    const clone = createSnapshot(live)
    const button = clone.querySelector('button')!

    const path = pathTo(clone, button)
    expect(path).not.toBeNull()

    expect(nodeByPath(live, path!)).toBe(live.querySelector('button'))
  })

  it('returns null when the node is outside the subtree', () => {
    const { live } = createCell()

    expect(pathTo(live, document.body)).toBeNull()
  })
})
