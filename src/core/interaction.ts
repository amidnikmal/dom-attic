import type { Attic } from './attic'
import { isSnapshot } from './snapshot'
import { nodeByPath, pathTo, replayOn } from './twin'

/** События, по которым снимок уступает место живому компоненту. */
const REVIVE_EVENTS = ['pointerdown', 'focusin'] as const

/**
 * Единственный вход в живой компонент: взаимодействие со снимком.
 * Слушатели вешаются один раз на корень, а не на каждую ячейку.
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

    // Путь запоминается до подмены: сразу после неё target покидает документ.
    const path = pathTo(snapshot, target)
    const live = attic.revive(key)
    if (!live || !attic.replayEvents || !path) return

    const twin = nodeByPath(live, path)
    if (twin) replayOn(twin, event.type)
  }

  REVIVE_EVENTS.forEach((type) => root.addEventListener(type, handler, true))

  return () => REVIVE_EVENTS.forEach((type) => root.removeEventListener(type, handler, true))
}
