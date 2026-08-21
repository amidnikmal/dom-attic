import { afterEach, describe, expect, it } from 'vitest'

import { Farm } from '../src/core/index'
import { cleanup, createCell } from './helpers'

afterEach(cleanup)

describe('Farm', () => {
  it('hands a node to a placeholder without remounting it', () => {
    const farm = new Farm()
    const { live, clicks } = createCell()
    const host = document.createElement('div')
    document.body.append(host)

    live.querySelector('button')!.click()
    farm.register('a', live)

    expect(farm.adopt('a', host)).toBe(true)
    expect(host.firstElementChild).toBe(live)
    expect(clicks()).toBe(1)

    live.querySelector('button')!.click()
    expect(clicks()).toBe(2)
  })

  it('takes the node back instead of destroying it', () => {
    const farm = new Farm()
    const { live } = createCell()
    const host = document.createElement('div')
    document.body.append(host)

    farm.register('a', live)
    farm.adopt('a', host)
    farm.release('a')

    expect(host.firstElementChild).toBeNull()
    // The container lives in the document but is hidden, so the node is still
    // connected: what matters is that it went back to the farm.
    expect(live.parentElement).toBe(farm.container)
    expect(farm.has('a')).toBe(true)
  })

  it('survives a full round trip, which is what scrolling does', () => {
    const farm = new Farm()
    const { live, clicks } = createCell()
    const first = document.createElement('div')
    const second = document.createElement('div')
    document.body.append(first, second)

    farm.register('a', live)
    farm.adopt('a', first)
    live.querySelector('button')!.click()

    farm.release('a')
    farm.adopt('a', second)

    expect(second.firstElementChild).toBe(live)
    expect(live.querySelector('span')!.textContent).toBe('1')
    expect(clicks()).toBe(1)
  })

  it('serves a placeholder that asked before the content existed', () => {
    const farm = new Farm()
    const host = document.createElement('div')
    document.body.append(host)

    expect(farm.adopt('a', host)).toBe(false)

    const { live } = createCell()
    farm.register('a', live)

    expect(host.firstElementChild).toBe(live)
  })
})

describe('Farm recovery', () => {
  it('reclaims a node that was pulled away', () => {
    const farm = new Farm()
    const { live } = createCell()
    const host = document.createElement('div')
    const thief = document.createElement('div')
    document.body.append(host, thief)

    farm.register('a', live)
    farm.adopt('a', host)

    // Something else moved the node, as a keyed patch would.
    thief.append(live)
    expect(host.firstElementChild).toBeNull()

    // Registering again puts it back where the placeholder expects it.
    farm.register('a', live)
    expect(host.firstElementChild).toBe(live)
  })
})

describe('Farm claims', () => {
  it('knows which keys a placeholder is showing', () => {
    const farm = new Farm()
    const host = document.createElement('div')
    document.body.append(host)

    expect(farm.isClaimed('a')).toBe(false)

    farm.claim('a', host)
    expect(farm.isClaimed('a')).toBe(true)
    expect(farm.claimedKeys()).toEqual(['a'])
    expect(farm.targetFor('a')).toBe(host)

    farm.disclaim('a')
    expect(farm.isClaimed('a')).toBe(false)
    expect(farm.targetFor('a')).not.toBe(host)
  })

  it('notifies when claims change, so content can follow', () => {
    const farm = new Farm()
    const host = document.createElement('div')
    let calls = 0

    const stop = farm.subscribe(() => { calls++ })
    farm.claim('a', host)
    farm.disclaim('a')
    stop()
    farm.claim('b', host)

    expect(calls).toBe(2)
  })
})

describe('Farm reporting', () => {
  it('takes a copy on request and tells the cell apart from its trimmings', () => {
    const farm = new Farm()
    const { live } = createCell()
    const host = document.createElement('div')
    const placeholder = document.createElement('span')
    placeholder.className = 'attic-fallback'
    host.append(placeholder)
    document.body.append(host)

    farm.register('a', live)
    farm.claim('a', host)
    farm.adopt('a', host)

    expect(farm.capture('a')).toBe(true)
    // the placeholder is not the cell, so it is not what got copied
    expect(farm.snapshotFor('a')?.className).not.toContain('attic-fallback')
  })

  it('refuses to copy a cell whose content has not arrived', () => {
    const farm = new Farm()
    const host = document.createElement('div')
    document.body.append(host)

    farm.claim('a', host)

    expect(farm.capture('a')).toBe(false)
    expect(farm.hasSnapshot('a')).toBe(false)
  })

  it('remembers a cell that is too large to copy', () => {
    const farm = new Farm()
    const live = document.createElement('div')
    for (let i = 0; i < 50; i++) live.append(document.createElement('span'))
    const host = document.createElement('div')
    document.body.append(host)

    farm.register('a', live)
    farm.claim('a', host)
    farm.adopt('a', host)

    expect(farm.capture('a', 5)).toBe(false)
    expect(farm.isUncopyable('a')).toBe(true)
    expect(farm.stats.tooLarge).toBe(1)
  })

  it('describes the state of a single cell', () => {
    const farm = new Farm()
    const { live } = createCell()
    const host = document.createElement('div')
    document.body.append(host)

    expect(farm.inspect('a')).toEqual({
      claimed: false, grown: false, settled: false, hasSnapshot: false, uncopyable: false,
    })

    farm.register('a', live)
    farm.claim('a', host)
    farm.adopt('a', host)
    farm.capture('a')

    expect(farm.inspect('a')).toEqual({
      claimed: true, grown: true, settled: true, hasSnapshot: true, uncopyable: false,
    })

    farm.release('a')
    expect(farm.inspect('a').settled).toBe(false)
  })

  it('reports sizes alongside counters', () => {
    const farm = new Farm()
    const { live } = createCell()
    const host = document.createElement('div')
    document.body.append(host)

    farm.register('a', live)
    farm.claim('a', host)
    farm.adopt('a', host)
    farm.capture('a')

    expect(farm.stats).toMatchObject({ content: 1, claimed: 1, snapshots: 1, captured: 1 })
  })
})
