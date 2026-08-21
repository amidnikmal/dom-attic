import { createSnapshot, SNAPSHOT_ATTR } from './snapshot'

export type FarmKey = string

/** Class the placeholder wrapper carries, so it is never mistaken for content. */
export const FALLBACK_CLASS = 'attic-fallback'

/** What the farm knows about one cell. */
export interface FarmCellState {
  /** A placeholder is showing this key right now. */
  claimed: boolean
  /** Content for the key exists somewhere — in a host or in the farm. */
  grown: boolean
  /** The content is in the host that claims it, rather than on its way. */
  settled: boolean
  hasSnapshot: boolean
  /** The cell was looked at and found too large to copy. */
  uncopyable: boolean
}

export interface FarmStats {
  /** Counters since the farm was created. */
  grown: number
  adopted: number
  released: number
  captured: number
  tooLarge: number
  /** Sizes right now. */
  content: number
  claimed: number
  snapshots: number
}

/**
 * A holding area for cell content that must outlive the row showing it.
 *
 * Virtualization removes rows from the DOM, and with them anything a framework
 * mounted inside. The farm keeps that content mounted somewhere else and lends
 * a node to whichever placeholder currently displays it: scrolling a row out of
 * view returns the node here instead of destroying it.
 */
export class Farm {
  /** Nodes produced by the farm, addressed by cell key. */
  private readonly nodes = new Map<FarmKey, HTMLElement>()
  /** Where a node currently lives, if a placeholder took it. */
  private readonly hosts = new Map<FarmKey, HTMLElement>()
  private readonly home = document.createElement('div')
  private readonly listeners = new Set<() => void>()
  /**
   * Frozen copies of cells that have been shown at least once. Cloning a
   * mounted node is an order of magnitude cheaper than building it again, so a
   * cell that comes back into view can show its own likeness immediately while
   * the live one is on its way.
   */
  private readonly snapshots = new Map<FarmKey, HTMLElement>()

  private readonly counters = { grown: 0, adopted: 0, released: 0, captured: 0, tooLarge: 0 }

  /** Counters and current sizes: the first thing worth looking at when the
      farm behaves oddly. */
  get stats(): FarmStats {
    return {
      ...this.counters,
      content: this.nodes.size,
      claimed: this.hosts.size,
      snapshots: this.snapshots.size,
    }
  }

  /** Everything the farm knows about one cell, in one call. */
  inspect(key: FarmKey): FarmCellState {
    const host = this.hosts.get(key)

    return {
      claimed: Boolean(host),
      grown: this.nodes.has(key),
      settled: Boolean(host && this.contentIn(host)),
      hasSnapshot: this.snapshots.has(key),
      uncopyable: this.uncopyable.has(key),
    }
  }

  /**
   * The cell's own content inside a host — neither the placeholder nor a
   * frozen copy, both of which live in the same host.
   */
  private contentIn(host: HTMLElement): HTMLElement | undefined {
    return [...host.children].find(
      (child) => !child.classList.contains(FALLBACK_CLASS)
        && !child.hasAttribute(SNAPSHOT_ATTR),
    ) as HTMLElement | undefined
  }

  constructor() {
    this.home.style.display = 'none'
    this.home.setAttribute('data-attic-home', '')

    // The container has to be in the document: content teleported into a
    // detached node is never mounted, so cells would stay empty until they
    // are shown. Hidden costs nothing — display:none skips layout and paint.
    document.body.append(this.home)
  }

  /** Notified whenever a placeholder appears or goes away. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener())
  }

  /** Keys a placeholder is showing right now. */
  claimedKeys(): FarmKey[] {
    return [...this.hosts.keys()]
  }

  isClaimed(key: FarmKey): boolean {
    return this.hosts.has(key)
  }

  /** Where content for a key should currently live. */
  targetFor(key: FarmKey): HTMLElement {
    return this.hosts.get(key) ?? this.home
  }

  /** A placeholder claims a key; content moves there on the next render. */
  claim(key: FarmKey, host: HTMLElement): void {
    this.hosts.set(key, host)
    this.counters.adopted++
    this.notify()
  }

  /** The placeholder is gone, so content goes back to the farm. */
  disclaim(key: FarmKey): void {
    if (!this.hosts.delete(key)) return

    this.counters.released++
    this.notify()
  }

  /** The element the farm renders its content into. */
  get container(): HTMLElement {
    return this.home
  }

  /** The farm rendered content for a key. */
  register(key: FarmKey, element: HTMLElement | null): void {
    if (!element) {
      this.nodes.delete(key)
      this.hosts.delete(key)
      return
    }

    this.nodes.set(key, element)
    this.counters.grown++

    // A placeholder may already be waiting for this key.
    const host = this.hosts.get(key)
    if (host && element.parentElement !== host) host.append(element)
  }

  has(key: FarmKey): boolean {
    return this.nodes.has(key)
  }

  /** A placeholder takes the node over: the node moves, nothing remounts. */
  adopt(key: FarmKey, host: HTMLElement): boolean {
    this.hosts.set(key, host)

    const node = this.nodes.get(key)
    if (!node) return false

    host.append(node)
    this.counters.adopted++

    return true
  }

  /** The placeholder is going away, so the node comes back to the farm. */
  release(key: FarmKey): void {
    const node = this.nodes.get(key)
    this.hosts.delete(key)

    if (!node) return

    this.home.append(node)
    this.counters.released++
  }

  /**
   * Takes a likeness of the cell as it looks right now.
   *
   * Returns false when there is nothing to copy yet — the cell is claimed but
   * its content has not arrived — or when the cell is too large to be worth
   * copying, in which case it is remembered as such and not tried again.
   */
  capture(key: FarmKey, maxNodes?: number): boolean {
    const host = this.hosts.get(key)
    const content = host && this.contentIn(host)
    if (!content) return false

    const copy = createSnapshot(content, maxNodes)
    if (!copy) {
      this.counters.tooLarge++
      this.uncopyable.add(key)

      return false
    }

    this.snapshots.set(key, copy)
    this.counters.captured++

    return true
  }

  /** Keys that were looked at and found too large to copy. */
  private readonly uncopyable = new Set<FarmKey>()

  markUncopyable(key: FarmKey): void {
    this.uncopyable.add(key)
  }

  isUncopyable(key: FarmKey): boolean {
    return this.uncopyable.has(key)
  }

  hasSnapshot(key: FarmKey): boolean {
    return this.snapshots.has(key)
  }

  snapshotFor(key: FarmKey): HTMLElement | undefined {
    return this.snapshots.get(key)
  }

  forgetSnapshot(key: FarmKey): void {
    this.snapshots.get(key)?.remove()
    this.snapshots.delete(key)
    // The cell may have become copyable since: a list that was open when it
    // was last looked at is closed now.
    this.uncopyable.delete(key)

    // Waking the farm matters: it may have finished its work long ago, and
    // without a nudge the copy would never be taken again.
    this.notify()
  }

  clear(): void {
    this.nodes.clear()
    this.hosts.clear()
    this.listeners.clear()
    this.snapshots.forEach((node) => node.remove())
    this.snapshots.clear()
    this.home.remove()
  }
}
