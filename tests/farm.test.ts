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
    expect(live.isConnected).toBe(false)
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
