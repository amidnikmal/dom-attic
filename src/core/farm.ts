export type FarmKey = string

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

  readonly stats = { grown: 0, adopted: 0, released: 0 }

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
    this.stats.adopted++
    this.notify()
  }

  /** The placeholder is gone, so content goes back to the farm. */
  disclaim(key: FarmKey): void {
    if (!this.hosts.delete(key)) return

    this.stats.released++
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
    this.stats.grown++

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
    this.stats.adopted++

    return true
  }

  /** The placeholder is going away, so the node comes back to the farm. */
  release(key: FarmKey): void {
    const node = this.nodes.get(key)
    this.hosts.delete(key)

    if (!node) return

    this.home.append(node)
    this.stats.released++
  }

  clear(): void {
    this.nodes.clear()
    this.hosts.clear()
    this.listeners.clear()
    this.home.remove()
  }
}
