import {
  computed,
  defineComponent,
  h,
  inject,
  type InjectionKey,
  onBeforeUnmount,
  onMounted,
  provide,
  type Ref,
  ref,
  shallowRef,
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

/** Ref callbacks may hand over a component instance instead of an element. */
function asElement(value: unknown): HTMLElement | null {
  if (value instanceof HTMLElement) return value

  const root = (value as { $el?: unknown } | null)?.$el
  return root instanceof HTMLElement ? root : null
}

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

const FARM_KEY: InjectionKey<Farm> = Symbol('attic-farm')

/**
 * Creates a farm and shares it with the placeholders below.
 *
 * Content is rendered by AtticFarm once per key and handed to whichever
 * AtticSlot displays that key at the moment, so scrolling a row out of view
 * no longer destroys what was inside it.
 */
export function useFarm(): Farm {
  const farm = new Farm()

  provide(FARM_KEY, farm)
  onBeforeUnmount(() => farm.clear())

  return farm
}

function injectFarm(): Farm {
  const farm = inject(FARM_KEY)
  if (!farm) throw new Error('[dom-attic] AtticFarm and AtticSlot require useFarm()')

  return farm
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
     * How many entries to add per idle slice. Mounting a few hundred heavy
     * cells in one patch freezes the tab, so the farm grows in steps and
     * yields to the browser in between.
     */
    chunk: { type: Number, default: 20 },
  },
  setup(props, { slots }) {
    const farm = injectFarm()
    const containerRef = ref<HTMLElement>()
    const budget = ref(props.chunk)

    onMounted(() => {
      // The farm's own container is detached, so nothing here costs layout.
      if (containerRef.value) farm.container.append(containerRef.value)
    })

    const ordered = computed(() => [...props.keys].sort())

    const rendered = computed(() => ordered.value.slice(0, budget.value))

    let growing = false

    /** Grows the rendered set until it covers every key it was given. */
    async function grow() {
      if (growing) return
      growing = true

      while (budget.value < ordered.value.length) {
        await yieldToBrowser()
        budget.value += props.chunk
      }

      growing = false
    }

    watch(ordered, () => {
      // A shrunken set should release its extra entries right away.
      budget.value = Math.min(budget.value, Math.max(ordered.value.length, props.chunk))
      void grow()
    }, { immediate: true })

    return () =>
      h(
        'div',
        { ref: containerRef, class: 'attic-farm' },
        rendered.value.map((key) =>
          h(
            'div',
            {
              key,
              class: 'attic-farm__item',
              ref: (element: unknown) => farm.register(key, asElement(element)),
            },
            slots.default?.({ cellKey: key }),
          ),
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
    const farm = injectFarm()
    const hostRef = ref<HTMLElement>()

    const adopt = () => {
      if (hostRef.value) farm.adopt(props.cellKey, hostRef.value)
    }

    onMounted(() => {
      adopt()

      // A node can still be pulled away by an unrelated patch, so the slot
      // takes it back as soon as it notices the host went empty.
      observer = new MutationObserver(() => {
        if (hostRef.value && !hostRef.value.firstElementChild) adopt()
      })
      if (hostRef.value) observer.observe(hostRef.value, { childList: true })
    })

    let observer: MutationObserver | undefined
    watch(() => props.cellKey, (next, previous) => {
      farm.release(previous)
      void next
      adopt()
    })

    onBeforeUnmount(() => {
      observer?.disconnect()
      farm.release(props.cellKey)
    })

    return () => h('div', { ref: hostRef, class: 'attic-slot' }, slots.fallback?.())
  },
})
