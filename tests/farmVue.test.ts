import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'

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
const tick = () => new Promise((resolve) => setTimeout(resolve, 60))

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
