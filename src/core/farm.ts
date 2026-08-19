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

  readonly stats = { grown: 0, adopted: 0, released: 0 }

  constructor() {
    this.home.style.display = 'none'
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
    this.home.replaceChildren()
  }
}
