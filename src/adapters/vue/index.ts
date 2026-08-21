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
  nodeByPath,
  pathTo,
  replayOn,
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
  /**
   * Cells the user has just touched. They jump the queue: waiting a couple of
   * hundred milliseconds is fine while scrolling, but not after a click.
   */
  urgent: Set<string>
  /** Bumped whenever the urgent set changes, so the farm can react to it. */
  urgentRevision: Ref<number>
  /**
   * Cells that are not built until someone touches them. Content that cannot
   * be mounted within a frame — a control holding thousands of entries — is
   * better left unbuilt while the list scrolls: the placeholder stands in for
   * it, and the cost moves to the first press instead of every pass.
   */
  lazy: Set<string>
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
  const urgent = new Set<string>()
  const urgentRevision = ref(0)
  const lazy = new Set<string>()

  provide(FARM_KEY, { farm, targets, applied, urgent, urgentRevision, lazy })
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
 * Entries are rendered in the order they were mounted, and each is teleported
 * to its own host, so the order of `keys` never moves a node a placeholder is
 * currently showing.
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
    const { farm, targets, applied, urgent, urgentRevision, lazy } = injectFarm()

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
    /** What a single cell cost last time, in milliseconds. */
    let perCell = 0

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

    /**
     * Keys whose content is not where the placeholders now want it. Only what
     * is actually mounted counts: aiming a teleport at a cell that does not
     * exist yet would tell its placeholder the wait is over.
     */
    function misplaced(): string[] {
      const result: string[] = []

      targets.forEach((host, key) => {
        if (grown.has(key) && applied.value.get(key) !== host) result.push(key)
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
      let taken = 0

      for (const key of unphotographed()) {
        if (taken === count) break

        // The farm knows where the content is and whether it is worth copying;
        // a refusal means there is nothing to photograph yet, and reporting
        // work here would spin the loop and starve the mounting it waits for.
        if (farm.capture(key, props.maxSnapshotNodes)) taken++
      }

      return taken > 0
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

    /** Serves a touched cell at once, ahead of the paced queue. */
    function serveUrgent(): boolean {
      // A key that left the window will never be served, so it is dropped
      // rather than kept forever.
      urgent.forEach((key) => {
        if (!wanted.value.has(key)) urgent.delete(key)
      })

      const keys = [...urgent]
      if (!keys.length) return false

      keys.forEach((key) => {
        grown.add(key)

        const host = targets.get(key)
        if (host) {
          const next = new Map(applied.value)
          next.set(key, host)
          applied.value = next
        }

        urgent.delete(key)
      })

      return true
    }

    watch(urgentRevision, () => void grow())

    /** Cells someone is showing come first; the rest is only warm-up. */
    function pending(): string[] {
      // Nothing is mounted while the window is still moving. Heavy content
      // costs more than a frame, so building it mid-scroll stutters; the
      // placeholder already shows the value, and mounting starts as soon as
      // scrolling settles.
      if (moving()) return []

      const shown = [...targets.keys()].filter(
        (key) => wanted.value.has(key) && !grown.has(key) && !lazy.has(key),
      )

      return [...shown, ...props.keys.filter((key) => !grown.has(key) && !lazy.has(key))]
    }

    async function grow() {
      if (growing) return
      growing = true

      while (true) {
        // A touched cell is served before anything else, moving window or not.
        if (serveUrgent()) {
          await nextTick()
          continue
        }

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

        // A cell that is already in place gets photographed before the queue
        // moves on. Leaving it to the end would mean no copies at all while
        // there is anything left to mount — which is exactly when they are
        // needed. One at a time: cloning is cheaper than building, but still
        // more than a frame can afford.
        if (!moving() && captureSome(1)) {
          await nextTick()
          await yieldToBrowser()
          continue
        }

        const queue = pending()
        if (!queue.length) {
          // Cells built on demand are never owed, so waiting for them would
          // keep the loop running forever.
          const owed = props.keys.filter((key) => !lazy.has(key))

          if (owed.every((key) => grown.has(key)) && !pendingMoves()) break

          // Nothing to do right now, but warm-up is still owed: wait it out.
          await yieldToBrowser()
          continue
        }

        const startedAt = performance.now()

        // Cells on screen are filled several at a time: waiting a second for
        // them to appear one by one looks like a page that is still loading.
        // Cheap cells only, though — a handful of expensive ones in a single
        // patch is exactly the freeze this pacing exists to avoid.
        const onScreen = queue.some((key) => targets.has(key))
        const affordable = perCell < 50
        const take = onScreen && affordable ? Math.max(slice, props.visibleSlice) : slice
        queue.slice(0, take).forEach((key) => grown.add(key))

        // Wait for the patch so the measurement covers the real mounting cost.
        await nextTick()
        const took = performance.now() - startedAt
        perCell = took / Math.max(take, 1)

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
    /**
     * Any value that changes together with the cell's data. A frozen copy
     * taken before the change would show what the cell used to be, so it is
     * dropped and taken anew.
     */
    revision: { type: [String, Number], default: 0 },
    /**
     * Do not build this cell until someone touches it. Worth it when the
     * content cannot be mounted within a frame; such a cell must be given a
     * `fallback`, because until the first press there is nothing else to show.
     */
    onDemand: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    const { farm, targets, applied, urgent, urgentRevision, lazy } = injectFarm()
    const hostRef = ref<HTMLElement>()

    // After the patch, not before: a copy taken while the DOM still shows the
    // previous value would be stale the moment it is made.
    watch(() => props.revision, () => farm.forgetSnapshot(props.cellKey), { flush: 'post' })

    /** Claiming a key makes the farm teleport its content here. */
    const claim = () => {
      if (!hostRef.value) return

      if (props.onDemand) lazy.add(props.cellKey)
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

    /**
     * A copy or a placeholder is inert, so a press on it would go nowhere.
     * The cell is pulled in front of the queue and the press is repeated on
     * the matching element of the real content — otherwise the first click on
     * a cell is always lost.
     */
    let awaitingPress: (() => void) | undefined

    function onPress(event: PointerEvent | FocusEvent): void {
      const host = hostRef.value
      if (!host || !pending.value) return

      const stand = host.querySelector<HTMLElement>(
        ':scope > [data-attic-snapshot], :scope > .attic-fallback',
      )
      const path = stand ? pathTo(stand, event.target as Element) : null
      const pressed = props.cellKey

      // Once asked for, the cell stops being lazy: from here on it is kept
      // like any other, copies and all.
      lazy.delete(pressed)
      urgent.add(pressed)
      urgentRevision.value++

      awaitingPress?.()
      const stop = watch(pending, (waiting) => {
        if (waiting) return

        stop()
        awaitingPress = undefined

        // The slot may have been handed to another row while the content was
        // on its way. Repeating the press then would act on someone else's
        // data, so it is dropped instead.
        if (props.cellKey !== pressed) return

        const live = [...host.children].find(
          (child) => !child.classList.contains('attic-fallback')
            && !child.hasAttribute('data-attic-snapshot'),
        )

        if (!(live instanceof HTMLElement)) return

        const twin = path ? nodeByPath(live, path) : null
        replayOn(twin ?? live, event.type)
      }, { flush: 'post' })

      awaitingPress = stop
    }

    const disclaim = (key: string) => {
      lazy.delete(key)
      targets.delete(key)
      farm.disclaim(key)
    }

    onMounted(claim)

    watch(() => props.cellKey, (next, previous) => {
      awaitingPress?.()
      awaitingPress = undefined

      disclaim(previous)
      void next
      claim()
    })

    onBeforeUnmount(() => {
      awaitingPress?.()
      hostRef.value?.querySelector(':scope > [data-attic-snapshot]')?.remove()
      disclaim(props.cellKey)
    })

    return () =>
      h(
        'div',
        {
          ref: hostRef,
          class: 'attic-slot',
          onPointerdownCapture: onPress,
          onFocusinCapture: onPress,
          ...(pending.value ? { 'data-attic-pending': '' } : {}),
        },
        [slots.fallback ? h('span', { class: 'attic-fallback' }, slots.fallback()) : null],
      )
  },
})
