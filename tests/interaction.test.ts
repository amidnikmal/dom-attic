import { afterEach, describe, expect, it } from 'vitest'

import { attachInteraction, Attic, isSnapshot } from '../src/core/index'
import { cleanup, createCell } from './helpers'

afterEach(cleanup)

function pointerDown(target: Element): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
}

describe('attachInteraction', () => {
  it('оживляет ячейку и не теряет первое нажатие', () => {
    const attic = new Attic()
    const { host, live, clicks } = createCell()

    attic.register('a', host)
    attic.park('a')
    attachInteraction(attic, document.body)

    pointerDown(host.firstElementChild!.querySelector('button')!)

    expect(host.firstElementChild).toBe(live)
    expect(clicks()).toBe(1)
  })

  it('не трогает уже живые ячейки', () => {
    const attic = new Attic()
    const { host, clicks } = createCell()

    attic.register('a', host)
    attachInteraction(attic, document.body)

    pointerDown(host.querySelector('button')!)

    expect(clicks()).toBe(0)
  })

  it('replayEvents: false оживляет, но не повторяет нажатие', () => {
    const attic = new Attic({ replayEvents: false })
    const { host, live, clicks } = createCell()

    attic.register('a', host)
    attic.park('a')
    attachInteraction(attic, document.body)

    pointerDown(host.firstElementChild!.querySelector('button')!)

    expect(host.firstElementChild).toBe(live)
    expect(clicks()).toBe(0)
  })

  it('снятый слушатель больше не оживляет', () => {
    const attic = new Attic()
    const { host } = createCell()

    attic.register('a', host)
    attic.park('a')
    const detach = attachInteraction(attic, document.body)
    detach()

    pointerDown(host.firstElementChild!.querySelector('button')!)

    expect(isSnapshot(host.firstElementChild)).toBe(true)
  })
})
