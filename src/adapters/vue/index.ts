import {
  type Component,
  computed,
  defineComponent,
  h,
  inject,
  type InjectionKey,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  type Ref,
  ref,
  shallowReactive,
  shallowRef,
  Teleport,
  watch,
} from 'vue'

import {
  attachInteraction,
  Attic,
  type AtticOptions,
  type AtticStats,
  Farm,
  yieldToBrowser,
} from '../../core/index'



const ATTIC_KEY: InjectionKey<Attic> = Symbol('attic')

export interface UseAtticRoot {
  attic: Attic
  /** Attach to the container the cells live in. */
  rootRef: Ref<HTMLElement | undefined>
  stats: Ref<AtticStats>
  refreshStats: () => void
}

/**
 * Creates an attic for the current component and shares it with nested cells.
 * Interaction is captured by a single listener on rootRef.
 */
export function useAtticRoot(options: AtticOptions = {}): UseAtticRoot {
  const attic = new Attic(options)
  const rootRef = ref<HTMLElement>()
  const stats = shallowRef<AtticStats>(attic.stats)

  const refreshStats = () => {
    stats.value = attic.stats
  }

  provide(ATTIC_KEY, attic)

  let detach: (() => void) | undefined

  onMounted(() => {
    if (rootRef.value) detach = attachInteraction(attic, rootRef.value)
  })

  onBeforeUnmount(() => {
    detach?.()
    attic.dispose()
  })

  return { attic, rootRef, stats, refreshStats }
}

export function useAttic(): Attic {
  const attic = inject(ATTIC_KEY)
  if (!attic) throw new Error('[dom-attic] useAttic must be used inside useAtticRoot')

  return attic
}

/**
 * Cell wrapper: its root element is the host whose content is swapped for a
 * snapshot. The slot content is mounted once.
 */
export const AtticCell = defineComponent({
  name: 'AtticCell',
  props: {
    cellKey: { type: String, required: true },
    /** Park in storage right after mounting. */
    parkOnMount: { type: Boolean, default: true },
    /** Any value that changes with the cell data: the snapshot gets retaken. */
    revision: { type: [String, Number], default: 0 },
  },
  setup(props, { slots }) {
    const attic = useAttic()
    const hostRef = ref<HTMLElement>()

    onMounted(async () => {
      if (!hostRef.value) return

      attic.register(props.cellKey, hostRef.value)
      if (props.parkOnMount) attic.park(props.cellKey)
    })

    onBeforeUnmount(() => attic.unregister(props.cellKey))

    watch(
      () => props.revision,
      async () => {
        attic.markDirty(props.cellKey)
        // The framework has already patched the live node, so just retake the snapshot.
        await yieldToBrowser()
        attic.refresh(props.cellKey)
      },
      { flush: 'post' },
    )

    return () => h('div', { ref: hostRef, class: 'attic-cell' }, slots.default?.())
  },
})

/* farm: cell content that outlives the row showing it */

interface FarmContext {
  farm: Farm
  /** Where each key is shown right now; reactive so Teleport follows it. */
  targets: Map<string, HTMLElement>
}

const FARM_KEY: InjectionKey<FarmContext> = Symbol('attic-farm')

/**
 * Creates a farm and shares it with the placeholders below.
 *
 * Content is rendered by AtticFarm once per key and handed to whichever
 * AtticSlot displays that key at the moment, so scrolling a row out of view
 * no longer destroys what was inside it.
 */
export function useFarm(): Farm {
  const farm = new Farm()
  const targets = shallowReactive(new Map<string, HTMLElement>())

  provide(FARM_KEY, { farm, targets })
  onBeforeUnmount(() => farm.clear())

  return farm
}

function injectFarm(): FarmContext {
  const context = inject(FARM_KEY)
  if (!context) throw new Error('[dom-attic] AtticFarm and AtticSlot require useFarm()')

  return context
}

/**
 * Renders content for every key it is given, out of sight.
 *
 * The list is rendered in sorted order rather than the order it arrives in.
 * A keyed patch moves nodes around when the order changes, and a node that a
 * placeholder currently shows would be dragged back here mid-patch, blanking
 * the cell or throwing. Sorting makes the order depend on the keys alone, so
 * reordering the data leaves the rendered list untouched.
 */
export const AtticFarm = defineComponent({
  name: 'AtticFarm',
  props: {
    keys: { type: Array as () => string[], required: true },
    /**
     * Upper bound for how many entries may be added in one slice. The real
     * size adapts to how long the previous slice took, so heavy cells go in
     * one at a time while cheap ones go in batches.
     */
    chunk: { type: Number, default: 20 },
    /** How long after the last change of `keys` the farm resumes growing, ms. */
    settleDelay: { type: Number, default: 150 },
    /** Minimum slice for cells that are on screen once scrolling has stopped. */
    visibleSlice: { type: Number, default: 6 },
  },
  setup(props, { slots }) {
    const { farm, targets } = injectFarm()

    /**
     * Keys whose content is actually mounted. Kept as a set rather than a
     * count: when the window moves, every key is new, and a count would let
     * hundreds of heavy cells mount in a single patch, freezing the tab for
     * seconds. Growth is always paid for one slice at a time.
     */
    const grown = shallowReactive(new Set<string>())

    const wanted = computed(() => new Set(props.keys))
    const rendered = computed(() => [...grown].filter((key) => wanted.value.has(key)))

    /** Timestamp of the last change of `keys`, i.e. of the last scroll step. */
    let lastChange = 0
    let growing = false
    let slice = 1

    const moving = () => performance.now() - lastChange < props.settleDelay

    /** Cells someone is showing come first; the rest is only warm-up. */
    function pending(): string[] {
      // Nothing is mounted while the window is still moving. Heavy content
      // costs more than a frame, so building it mid-scroll stutters; the
      // placeholder already shows the value, and mounting starts as soon as
      // scrolling settles.
      if (moving()) return []

      const shown = [...targets.keys()].filter((key) => wanted.value.has(key) && !grown.has(key))

      return [...shown, ...props.keys.filter((key) => !grown.has(key))]
    }

    async function grow() {
      if (growing) return
      growing = true

      while (true) {
        // Dropping content is as expensive as building it, so stale entries
        // are released in slices too, and never while the window is moving.
        if (!moving()) {
          const stale = [...grown].filter((key) => !wanted.value.has(key))
          stale.slice(0, props.chunk).forEach((key) => grown.delete(key))

          if (stale.length) {
            await nextTick()
            await yieldToBrowser()
            continue
          }
        }

        const queue = pending()
        if (!queue.length) {
          if (props.keys.every((key) => grown.has(key)) && grown.size === wanted.value.size) break

          // Nothing to do right now, but warm-up is still owed: wait it out.
          await yieldToBrowser()
          continue
        }

        const startedAt = performance.now()

        // Cells on screen are filled several at a time: waiting a second for
        // them to appear one by one looks like a page that is still loading.
        const onScreen = queue.some((key) => targets.has(key))
        const take = onScreen ? Math.max(slice, props.visibleSlice) : slice
        queue.slice(0, take).forEach((key) => grown.add(key))

        // Wait for the patch so the measurement covers the real mounting cost.
        await nextTick()
        const took = performance.now() - startedAt

        // Half a frame is the target. Growth is gradual and shrinking is not:
        // doubling would keep overshooting on heavy cells and stutter.
        slice = took > 8
          ? Math.max(1, Math.floor(slice / 2))
          : Math.min(props.chunk, slice + 1)

        await yieldToBrowser()
      }

      growing = false
    }

    watch(() => props.keys, () => {
      lastChange = performance.now()
      void grow()
    }, { immediate: true, deep: true })

    // A cell coming into view has to be filled even mid-scroll.
    watch(() => targets.size, () => void grow())

    /**
     * Each entry is teleported to wherever its key is shown right now, or to
     * the farm's own hidden container when nothing shows it. Teleport moves
     * the existing DOM instead of remounting it, and — unlike moving nodes by
     * hand — Vue keeps track of where they went, so later patches stay valid.
     */
    return () =>
      rendered.value.map((key) =>
        // Teleport's own typing does not fit the generic h() overloads.
        h(
          Teleport as unknown as Component,
          { to: targets.get(key) ?? farm.container, key },
          { default: () => slots.default?.({ cellKey: key }) },
        ),
      )
  },
})

/** Shows whatever the farm grew for its key, without mounting anything itself. */
export const AtticSlot = defineComponent({
  name: 'AtticSlot',
  props: {
    cellKey: { type: String, required: true },
  },
  setup(props, { slots }) {
    const { farm, targets } = injectFarm()
    const hostRef = ref<HTMLElement>()

    /** Claiming a key makes the farm teleport its content here. */
    const claim = () => {
      if (!hostRef.value) return

      targets.set(props.cellKey, hostRef.value)
      farm.claim(props.cellKey, hostRef.value)
    }

    const disclaim = (key: string) => {
      targets.delete(key)
      farm.disclaim(key)
    }

    onMounted(claim)

    watch(() => props.cellKey, (next, previous) => {
      disclaim(previous)
      void next
      claim()
    })

    onBeforeUnmount(() => disclaim(props.cellKey))

    return () => h('div', { ref: hostRef, class: 'attic-slot' }, slots.fallback?.())
  },
})
