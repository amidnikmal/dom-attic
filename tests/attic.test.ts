import { afterEach, describe, expect, it } from 'vitest'

import { Attic, isSnapshot } from '../src/core/index'
import { cleanup, createCell } from './helpers'

afterEach(cleanup)

describe('Attic', () => {
  it('park leaves a snapshot and the live node leaves the document', () => {
    const attic = new Attic()
    const { host, live } = createCell()

    attic.register('a', host)
    expect(attic.park('a')).toBe(true)

    expect(isSnapshot(host.firstElementChild)).toBe(true)
    expect(live.isConnected).toBe(false)
    expect(attic.stats.parked).toBe(1)
  })

  it('revive returns the very same node with all of its state', () => {
    const attic = new Attic()
    const { host, live } = createCell()

    live.querySelector('button')!.click()
    live.querySelector('button')!.click()

    attic.register('a', host)
    attic.park('a')
    const revived = attic.revive('a')

    expect(revived).toBe(live)
    expect(host.firstElementChild).toBe(live)
    expect(live.querySelector('span')!.textContent).toBe('2')
  })

  it('the snapshot captures the state at park time', () => {
    const attic = new Attic()
    const { host, live } = createCell()

    live.querySelector('button')!.click()
    attic.register('a', host)
    attic.park('a')

    expect(host.firstElementChild!.querySelector('span')!.textContent).toBe('1')
  })

  it('evicts the oldest cell beyond the limit', () => {
    const evicted: string[] = []
    const attic = new Attic({ liveLimit: 2, onEvict: (key) => evicted.push(key) })

    const cells = ['a', 'b', 'c'].map((key) => {
      const cell = createCell()
      attic.register(key, cell.host)
      attic.park(key)
      return cell
    })

    attic.revive('a')
    attic.revive('b')
    attic.revive('c')

    expect(attic.stats.live).toBe(2)
    expect(evicted).toEqual(['a'])
    expect(isSnapshot(cells[0]!.host.firstElementChild)).toBe(true)
  })

  it('refresh rebuilds the snapshot only after markDirty', () => {
    const attic = new Attic()
    const { host, live } = createCell()

    attic.register('a', host)
    attic.park('a')

    // The live node changes while in storage, the way a framework patches it.
    live.querySelector('span')!.textContent = '42'

    expect(attic.refresh('a')).toBe(false)
    expect(host.firstElementChild!.querySelector('span')!.textContent).toBe('0')

    attic.markDirty('a')
    expect(attic.refresh('a')).toBe(true)
    expect(host.firstElementChild!.querySelector('span')!.textContent).toBe('42')
  })

  it('dispose returns live nodes to the document', () => {
    const attic = new Attic()
    const { host, live } = createCell()

    attic.register('a', host)
    attic.park('a')
    attic.dispose()

    expect(host.firstElementChild).toBe(live)
    expect(attic.stats.registered).toBe(0)
  })
})
