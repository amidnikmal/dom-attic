import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { AtticFarm, AtticSlot, useFarm } from '../src/adapters/vue/index'

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  stop = undefined
  document.body.replaceChildren()
})

/** Mounts a farm with a set of keys and a placeholder for each shown key. */
function mountFarm(initialKeys: string[], shown: string[]) {
  const keys = ref(initialKeys)
  const visible = ref(shown)
  const host = document.createElement('div')
  document.body.append(host)

  const App = defineComponent({
    setup() {
      useFarm()

      return () => [
        ...visible.value.map((key) => h(AtticSlot, { key, cellKey: key })),
        h(AtticFarm, { keys: keys.value, chunk: 2 }, {
          default: ({ cellKey }: { cellKey: string }) => h('b', { class: 'grown' }, cellKey),
        }),
      ]
    },
  })

  const app = createApp(App)
  app.mount(host)
  stop = () => app.unmount()

  return { keys, visible }
}

const grown = () => [...document.querySelectorAll('.attic-slot > .grown')].map((el) => el.textContent)
/** Longer than settleDelay: the farm waits for the window to settle. */
/** Longer than settleDelay plus a couple of slices: the farm waits for the
    window to settle, then moves and mounts in paced steps. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 500))

describe('AtticFarm', () => {
  it('fills the placeholders it is given', async () => {
    mountFarm(['a', 'b', 'c'], ['a', 'b'])
    await tick()

    expect(grown().sort()).toEqual(['a', 'b'])
  })

  it('serves a placeholder even when the key set jumps far away', async () => {
    const { keys, visible } = mountFarm(['a1', 'a2', 'a3', 'a4'], ['a1'])
    await tick()
    expect(grown()).toEqual(['a1'])

    // The window moves elsewhere entirely, as a long scroll does.
    keys.value = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6']
    visible.value = ['z5']
    await tick()

    expect(grown()).toEqual(['z5'])
  })
})

describe('AtticFarm growth', () => {
  it('does not mount a whole new window in one patch', async () => {
    const { keys, visible } = mountFarm(['a1', 'a2'], [])
    await tick()

    // The window jumps somewhere else entirely, as a long scroll does.
    keys.value = Array.from({ length: 40 }, (_, i) => `z${i}`)
    visible.value = []

    // Right after the change only a slice may have been added, not all 40.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const rightAfter = document.querySelectorAll('.grown').length
    expect(rightAfter).toBeLessThan(40)
  })

  it('fills a cell that came into view first, once the window settles', async () => {
    const { keys, visible } = mountFarm(Array.from({ length: 40 }, (_, i) => `a${i}`), [])
    await tick()

    keys.value = Array.from({ length: 40 }, (_, i) => `b${i}`)
    visible.value = ['b7']

    // Nothing is built while the window is still moving.
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(grown()).toEqual([])

    // Once it settles, the cell on screen is the first one served.
    await tick()
    expect(grown()).toEqual(['b7'])
  })

  it('forgets content that left the window', async () => {
    const { keys, visible } = mountFarm(['a', 'b'], ['a'])
    await tick()
    expect(document.querySelectorAll('.grown').length).toBeGreaterThan(0)

    keys.value = ['c']
    visible.value = ['c']
    await tick()

    const texts = [...document.querySelectorAll('.grown')].map((el) => el.textContent)
    expect(texts).not.toContain('a')
    expect(texts).not.toContain('b')
  })
})

describe('AtticFarm resilience', () => {
  it('keeps mounting when the parent re-renders with an equal key array', async () => {
    const keys = ref(['a', 'b', 'c'])
    const visible = ref(['a'])
    const host = document.createElement('div')
    document.body.append(host)

    const App = defineComponent({
      setup() {
        useFarm()
        const tick = ref(0)

        // A parent that re-renders often and hands over a fresh array each
        // time, which is what an inline prop function causes.
        const timer = setInterval(() => { tick.value++ }, 4)
        setTimeout(() => clearInterval(timer), 600)

        return () => [
          h('i', null, String(tick.value)),
          ...visible.value.map((key) => h(AtticSlot, { key, cellKey: key })),
          h(AtticFarm, { keys: [...keys.value], chunk: 2 }, {
            default: ({ cellKey }: { cellKey: string }) => h('b', { class: 'grown' }, cellKey),
          }),
        ]
      },
    })

    const app = createApp(App)
    app.mount(host)
    stop = () => app.unmount()

    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(grown()).toEqual(['a'])
  })
})

describe('AtticFarm retargeting', () => {
  it('marks a host as pending until the content actually moves in', async () => {
    const { keys, visible } = mountFarm(['a', 'b', 'c'], ['a'])
    await tick()
    expect(grown()).toEqual(['a'])

    // The window moves: the slot claims a new key straight away, but the
    // content must not be dragged across the DOM mid-scroll.
    keys.value = ['b', 'c', 'd']
    visible.value = ['c']
    await new Promise((resolve) => setTimeout(resolve, 30))

    const host = document.querySelector('.attic-slot') as HTMLElement
    expect(host.dataset.atticPending).toBe('')

    // Once it settles, the right content is in place and the mark is gone.
    await tick()
    expect(host.dataset.atticPending).toBeUndefined()
    expect(host.textContent).toBe('c')
  })
})

describe('AtticFarm likeness', () => {
  it('shows a frozen copy the moment a cell it has seen comes back', async () => {
    const { visible } = mountFarm(['a', 'b'], ['a'])
    await tick()
    await tick()
    expect((document.querySelector('.attic-slot') as HTMLElement).textContent).toContain('a')

    // The cell scrolls out of view...
    visible.value = []
    await tick()

    // ...and back in. Its live content is still on the way, so the copy taken
    // earlier stands in for it right away, with no empty frame.
    visible.value = ['a']
    await nextTick()

    const copy = document.querySelector('.attic-slot > [data-attic-snapshot]')
    expect(copy).not.toBeNull()
    expect(copy?.textContent).toContain('a')
  })
})

describe('AtticSlot press', () => {
  it('serves a touched cell at once and does not lose the press', async () => {
    const keys = ref(['a', 'b'])
    const visible = ref(['a'])
    const host = document.createElement('div')
    document.body.append(host)
    let clicks = 0

    const App = defineComponent({
      setup() {
        useFarm()

        return () => [
          ...visible.value.map((key) => h(AtticSlot, { key, cellKey: key }, {
            fallback: () => h('button', { class: 'stand' }, key),
          })),
          h(AtticFarm, { keys: keys.value, chunk: 1, settleDelay: 5_000 }, {
            default: ({ cellKey }: { cellKey: string }) =>
              h('button', { class: 'grown', onClick: () => { clicks++ } }, cellKey),
          }),
        ]
      },
    })

    const app = createApp(App)
    app.mount(host)
    stop = () => app.unmount()

    // settleDelay is huge, so nothing would be served on its own.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(grown()).toEqual([])

    // A press on the inert stand-in must bring the cell in and land on it.
    const stand = document.querySelector('.stand') as HTMLElement
    stand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(grown()).toEqual(['a'])
    expect(clicks).toBe(1)
  })
})

describe('AtticSlot handover safety', () => {
  it('drops a press when the slot has moved on to another cell', async () => {
    const keys = ref(['a', 'b'])
    const visible = ref([{ id: 0, key: 'a' }])
    const host = document.createElement('div')
    document.body.append(host)
    const pressed: string[] = []

    const App = defineComponent({
      setup() {
        useFarm()

        return () => [
          ...visible.value.map((row) => h(AtticSlot, { key: row.id, cellKey: row.key }, {
            fallback: () => h('button', { class: 'stand' }, row.key),
          })),
          h(AtticFarm, { keys: keys.value, chunk: 1, settleDelay: 4_000 }, {
            default: ({ cellKey }: { cellKey: string }) =>
              h('button', { class: 'grown', onClick: () => pressed.push(cellKey) }, cellKey),
          }),
        ]
      },
    })

    const app = createApp(App)
    app.mount(host)
    stop = () => app.unmount()

    await new Promise((resolve) => setTimeout(resolve, 40))

    // Press the cell showing 'a'...
    const stand = document.querySelector('.stand') as HTMLElement
    stand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

    // ...but the very same slot is handed to another row before the content
    // arrives, so the press must not land on 'b'.
    visible.value = [{ id: 0, key: 'b' }]
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(pressed).toEqual([])
  })

  it('retakes a copy when the cell data changes', async () => {
    const revision = ref(0)
    const label = ref('before')
    const host = document.createElement('div')
    document.body.append(host)

    const App = defineComponent({
      setup() {
        const farm = useFarm()
        ;(window as unknown as { __farm?: unknown }).__farm = farm

        return () => [
          h(AtticSlot, { cellKey: 'a', revision: revision.value }),
          h(AtticFarm, { keys: ['a'], chunk: 1 }, {
            default: () => h('b', { class: 'grown' }, label.value),
          }),
        ]
      },
    })

    const app = createApp(App)
    app.mount(host)
    stop = () => app.unmount()

    await tick()
    await tick()

    const farm = (window as unknown as {
      __farm: { snapshotFor: (k: string) => HTMLElement | undefined }
    }).__farm
    expect(farm.snapshotFor('a')?.textContent).toBe('before')

    // The data changed, so the copy taken before it is worthless and a fresh
    // one has to replace it.
    label.value = 'after'
    revision.value++
    await tick()
    await tick()

    expect(farm.snapshotFor('a')?.textContent).toBe('after')
  })
})

describe('AtticSlot on demand', () => {
  function mountLazy(listed = true) {
    const visible = ref(['a', 'b'])
    const host = document.createElement('div')
    document.body.append(host)
    const built: string[] = []
    const pressed: string[] = []

    const App = defineComponent({
      setup() {
        useFarm()

        return () => [
          ...visible.value.map((key) => h(AtticSlot, { key, cellKey: key, onDemand: true }, {
            fallback: () => h('button', { class: 'stand' }, `стенд ${key}`),
          })),
          // A host that knows a cell is built on demand has no reason to list
          // it for warm-up at all — the farm still has to serve it on a press.
          h(AtticFarm, { keys: listed ? visible.value : [], chunk: 2 }, {
            default: ({ cellKey }: { cellKey: string }) => {
              built.push(cellKey)

              return h('button', { class: 'grown', onClick: () => pressed.push(cellKey) }, cellKey)
            },
          }),
        ]
      },
    })

    const app = createApp(App)
    app.mount(host)
    stop = () => app.unmount()

    return { built, pressed, visible }
  }

  it('leaves the cell unbuilt until it is touched', async () => {
    const { built } = mountLazy()
    await tick()
    await tick()

    expect(built).toEqual([])
    expect(document.querySelectorAll('.stand')).toHaveLength(2)
  })

  it('builds the cell on a press and lands the press on it', async () => {
    const { built, pressed } = mountLazy()
    await tick()

    const stand = document.querySelector('.stand') as HTMLElement
    stand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(built).toEqual(['a'])
    expect(pressed).toEqual(['a'])
  })

  it('serves a touched cell the warm-up list never mentioned', async () => {
    const { built, pressed } = mountLazy(false)
    await tick()

    const stand = document.querySelector('.stand') as HTMLElement
    stand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(built).toEqual(['a'])
    expect(pressed).toEqual(['a'])
  })

  it('drops an unlisted cell once nothing shows it any more', async () => {
    const { visible } = mountLazy(false)
    await tick()

    const stand = document.querySelector('.stand') as HTMLElement
    stand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(document.querySelectorAll('.grown')).toHaveLength(1)

    // the placeholder is gone and no warm-up asks for the key, so the content
    // has nothing to hold it in place
    visible.value = ['b']
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(document.querySelectorAll('.grown')).toHaveLength(0)
  })

  it('keeps the cell like any other once it has been asked for', async () => {
    const { built } = mountLazy()
    await tick()

    const stand = document.querySelector('.stand') as HTMLElement
    stand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await tick()
    await tick()

    // the farm photographs it, so a return trip has something to show at once
    const farm = (document.querySelector('[data-attic-home]') as HTMLElement)
    expect(farm).not.toBeNull()
    expect(built).toEqual(['a'])
    expect(document.querySelectorAll('.grown')).toHaveLength(1)
  })
})
