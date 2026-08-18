import { createSnapshot, isSnapshot } from './snapshot'
import type { AtticOptions, AtticStats, CellKey, CellRecord } from './types'

export const KEY_ATTR = 'data-attic-key'

/**
 * Storage for live nodes and a registry of cells.
 *
 * The idea: a heavy component is mounted once and never recreated. When it is
 * not needed, its DOM node moves into a detached container, where there is no
 * layout and no paint, yet the component stays alive and keeps receiving
 * updates. An inert snapshot takes its place in the document.
 */
export class Attic {
  private readonly storage = document.createElement('div')
  private readonly cells = new Map<CellKey, CellRecord>()
  /** Insertion order is eviction order. */
  private readonly liveKeys = new Set<CellKey>()
  private readonly options: Required<Omit<AtticOptions, 'onEvict'>> & Pick<AtticOptions, 'onEvict'>

  private parks = 0
  private revives = 0

  constructor(options: AtticOptions = {}) {
    this.options = {
      liveLimit: options.liveLimit ?? 20,
      replayEvents: options.replayEvents ?? true,
      onEvict: options.onEvict,
    }
  }

  get replayEvents(): boolean {
    return this.options.replayEvents
  }

  /** Put a cell under management. The host already holds the mounted node. */
  register(key: CellKey, host: HTMLElement): void {
    host.setAttribute(KEY_ATTR, key)

    this.cells.set(key, {
      key,
      host,
      live: isSnapshot(host.firstElementChild) ? null : (host.firstElementChild as HTMLElement),
      state: 'live',
      dirty: false,
    })

    this.liveKeys.add(key)
  }

  unregister(key: CellKey): void {
    this.cells.delete(key)
    this.liveKeys.delete(key)
  }

  get(key: CellKey): CellRecord | undefined {
    return this.cells.get(key)
  }

  keys(): IterableIterator<CellKey> {
    return this.cells.keys()
  }

  /** Key of the cell an element belongs to. */
  keyOf(node: Element): CellKey | null {
    return node.closest(`[${KEY_ATTR}]`)?.getAttribute(KEY_ATTR) ?? null
  }

  /** Move the live node to storage, leaving a fresh snapshot behind. */
  park(key: CellKey): boolean {
    const cell = this.cells.get(key)
    if (!cell || cell.state === 'parked') return false

    const live = (cell.live ?? cell.host.firstElementChild) as HTMLElement | null
    if (!live || isSnapshot(live)) return false

    cell.host.replaceChild(createSnapshot(live), live)
    this.storage.appendChild(live)

    cell.live = live
    cell.state = 'parked'
    cell.dirty = false
    this.liveKeys.delete(key)
    this.parks++

    return true
  }

  /** Bring the live node back, evicting the oldest ones beyond the limit. */
  revive(key: CellKey): HTMLElement | null {
    const cell = this.cells.get(key)
    if (!cell?.live) return null
    if (cell.state === 'live') return cell.live

    cell.host.replaceChild(cell.live, cell.host.firstElementChild!)
    cell.state = 'live'
    cell.dirty = false
    this.liveKeys.add(key)
    this.revives++

    this.evictOverflow(key)

    return cell.live
  }

  private evictOverflow(protectedKey: CellKey): void {
    while (this.liveKeys.size > this.options.liveLimit) {
      const oldest = this.liveKeys.values().next().value
      if (oldest === undefined || oldest === protectedKey) break

      this.park(oldest)
      this.options.onEvict?.(oldest)
    }
  }

  /**
   * Cell data changed. The framework updates the live node on its own, even in
   * storage, but the snapshot is now stale and has to be retaken.
   */
  markDirty(key: CellKey): void {
    const cell = this.cells.get(key)
    if (cell?.state === 'parked') cell.dirty = true
  }

  /** Rebuild the cell snapshot from the current state of the live node. */
  refresh(key: CellKey): boolean {
    const cell = this.cells.get(key)
    if (!cell?.live || cell.state !== 'parked' || !cell.dirty) return false

    cell.host.replaceChild(createSnapshot(cell.live), cell.host.firstElementChild!)
    cell.dirty = false

    return true
  }

  dirtyKeys(): CellKey[] {
    return [...this.cells.values()].filter((cell) => cell.dirty).map((cell) => cell.key)
  }

  get stats(): AtticStats {
    return {
      registered: this.cells.size,
      live: this.liveKeys.size,
      parked: this.cells.size - this.liveKeys.size,
      parks: this.parks,
      revives: this.revives,
    }
  }

  /** Return every node to the document for the framework to unmount. */
  dispose(): void {
    this.cells.forEach((cell) => {
      if (cell.state === 'parked' && cell.live) {
        cell.host.replaceChild(cell.live, cell.host.firstElementChild!)
      }
    })

    this.cells.clear()
    this.liveKeys.clear()
    this.storage.replaceChildren()
  }
}
