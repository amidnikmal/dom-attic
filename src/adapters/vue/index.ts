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
  DEFAULT_MAX_SNAPSHOT_NODES,
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
  /**
   * Where each teleport actually points at the moment. Lags behind `targets`
   * on purpose: moving mounted content costs time, so it is paced. A slot
   * whose key has not arrived yet shows its placeholder instead.
   */
  applied: Ref<Map<string, HTMLElement>>
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
  const applied = shallowRef(new Map<string, HTMLElement>())

  provide(FARM_KEY, { farm, targets, applied })
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
    /** Cells larger than this are never copied: the copy would cost as much. */
    maxSnapshotNodes: { type: Number, default: DEFAULT_MAX_SNAPSHOT_NODES },
  },
  setup(props, { slots }) {
    const { farm, targets, applied } = injectFarm()

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

    /**
     * Where each teleport currently points. Kept apart from the live claims:
     * moving a heavy node across the DOM costs real time, so while the window
     * is scrolling the nodes stay put and placeholders cover the wait; one
     * sync moves everything into place once the window settles.
     */
    /**
     * Keys that have to leave the host they occupy: the placeholder there now
     * shows a different row. They go first — a host cleared late would hold
     * two cells at once, the old one and the new one.
     */
    function evicted(): string[] {
      const result: string[] = []

      applied.value.forEach((host, key) => {
        if (targets.get(key) !== host) result.push(key)
      })

      return result
    }

    /** Keys whose content is not where the placeholders now want it. */
    function misplaced(): string[] {
      const result: string[] = []

      targets.forEach((host, key) => {
        if (applied.value.get(key) !== host) result.push(key)
      })

      return result
    }

    function pendingMoves(): number {
      return evicted().length + misplaced().length
    }

    /** Cells shown right now that have never been photographed. */
    function unphotographed(): string[] {
      const result: string[] = []

      applied.value.forEach((host, key) => {
        if (targets.get(key) === host && !farm.hasSnapshot(key) && !farm.isUncopyable(key)) {
          result.push(key)
        }
      })

      return result
    }

    /**
     * Photographs a few settled cells. The copy is what a cell shows while its
     * live content is elsewhere, so it has to be taken from content that is
     * already in place — and only when nothing else is competing for the
     * main thread.
     */
    function captureSome(count: number): boolean {
      const queue = unphotographed()
      if (!queue.length) return false

      queue.slice(0, count).forEach((key) => {
        const host = targets.get(key)
        const content = host && [...host.children].find(
          (child) => !child.classList.contains('attic-fallback') && !child.hasAttribute('data-attic-snapshot'),
        )

        // A cell too large to copy is remembered as such, so the farm does not
        // keep trying and paying for it on every pass.
        if (content instanceof HTMLElement && !farm.capture(key, content, props.maxSnapshotNodes)) {
          farm.markUncopyable(key)
        }
      })

      return true
    }

    /** Moves a few teleports at a time, vacating hosts before filling them. */
    function moveSome(count: number): boolean {
      const leaving = evicted()
      const arriving = misplaced()
      if (!leaving.length && !arriving.length) return false

      const next = new Map(applied.value)

      // Vacating is cheap — the node goes back to the hidden container — so a
      // whole slice of it is done at once, ahead of any arrivals.
      leaving.forEach((key) => next.delete(key))

      if (!leaving.length) {
        arriving.slice(0, count).forEach((key) => {
          const host = targets.get(key)
          if (host) next.set(key, host)
        })
      }

      applied.value = next

      return true
    }

    const unsubscribe = farm.subscribe(() => void grow())
    onBeforeUnmount(unsubscribe)

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
        // Moving a mounted node across the DOM costs about as much as building
        // it, so retargeting is paced the same way and waits for quiet.
        if (!moving() && moveSome(Math.max(slice, props.visibleSlice))) {
          await nextTick()
          await yieldToBrowser()
          continue
        }

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
          // Photographing is the least urgent job, so it runs once nothing is
          // waiting to be mounted or moved.
          // One at a time: cloning a heavy cell is cheaper than building it,
          // but still more than a frame can afford.
          if (!moving() && captureSome(1)) {
            await nextTick()
            await yieldToBrowser()
            continue
          }

          if (props.keys.every((key) => grown.has(key))
            && grown.size === wanted.value.size
            && !pendingMoves()) break

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

    /**
     * Only a real change of the key set counts as movement. A parent that
     * re-renders hands over a fresh array with the same contents — treating
     * that as a moving window would postpone mounting forever.
     */
    let previous: string[] = []

    watch(() => props.keys, (keys) => {
      const changed = keys.length !== previous.length
        || keys.some((key, index) => key !== previous[index])

      if (!changed) return

      previous = [...keys]
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
          { to: applied.value.get(key) ?? farm.container, key },
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
    const { farm, targets, applied } = injectFarm()
    const hostRef = ref<HTMLElement>()

    /** Claiming a key makes the farm teleport its content here. */
    const claim = () => {
      if (!hostRef.value) return

      targets.set(props.cellKey, hostRef.value)
      farm.claim(props.cellKey, hostRef.value)
    }

    /**
     * Until the farm moves the right content in, the host may still hold a node
     * belonging to another key. The mark is derived rather than set by hand, so
     * it can never be left behind.
     */
    const pending = computed(() => applied.value.get(props.cellKey) !== hostRef.value)

    /**
     * While the live content is elsewhere, the cell shows its own frozen copy.
     * Inserting a ready node costs microseconds, so this happens in the same
     * frame the placeholder would otherwise be empty in.
     */
    function showLikeness(): void {
      const host = hostRef.value
      if (!host) return

      const shown = host.querySelector<HTMLElement>(':scope > [data-attic-snapshot]')
      const likeness = pending.value ? farm.snapshotFor(props.cellKey) : undefined

      if (shown && shown !== likeness) shown.remove()
      if (likeness && likeness.parentElement !== host) host.append(likeness)
    }

    watch([pending, () => props.cellKey], () => nextTick(showLikeness), { flush: 'post' })
    onMounted(showLikeness)

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

    onBeforeUnmount(() => {
      hostRef.value?.querySelector(':scope > [data-attic-snapshot]')?.remove()
      disclaim(props.cellKey)
    })

    return () =>
      h(
        'div',
        {
          ref: hostRef,
          class: 'attic-slot',
          ...(pending.value ? { 'data-attic-pending': '' } : {}),
        },
        [slots.fallback ? h('span', { class: 'attic-fallback' }, slots.fallback()) : null],
      )
  },
})
