import type { Attic } from './attic'
import { isSnapshot } from './snapshot'
import { nodeByPath, pathTo, replayOn } from './twin'

/** Events that make a snapshot step aside for the live component. */
const REVIVE_EVENTS = ['pointerdown', 'focusin'] as const

/**
 * The only way into a live component is interacting with its snapshot.
 * Listeners are attached once to the root, not to every cell.
 */
export function attachInteraction(attic: Attic, root: HTMLElement): () => void {
  const handler = (event: Event) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    const key = attic.keyOf(target)
    const cell = key ? attic.get(key) : undefined
    if (!key || !cell || cell.state !== 'parked') return

    const snapshot = cell.host.firstElementChild as HTMLElement | null
    if (!snapshot || !isSnapshot(snapshot)) return

    // The path is recorded before the swap: right after it the target leaves the document.
    const path = pathTo(snapshot, target)
    const live = attic.revive(key)
    if (!live || !attic.replayEvents || !path) return

    const twin = nodeByPath(live, path)
    if (twin) replayOn(twin, event.type)
  }

  REVIVE_EVENTS.forEach((type) => root.addEventListener(type, handler, true))

  return () => REVIVE_EVENTS.forEach((type) => root.removeEventListener(type, handler, true))
}
