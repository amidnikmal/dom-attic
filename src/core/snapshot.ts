export const SNAPSHOT_ATTR = 'data-attic-snapshot'

/** Properties cloneNode leaves behind: they do not live in attributes. */
function copyFieldState(from: ParentNode, to: ParentNode): void {
  const sources = from.querySelectorAll('input, select, textarea')
  const targets = to.querySelectorAll('input, select, textarea')

  sources.forEach((source, idx) => {
    const target = targets[idx] as HTMLInputElement | undefined
    if (!target) return

    const field = source as HTMLInputElement
    target.value = field.value
    target.checked = field.checked
  })
}

/** Scroll positions inside the cell are properties as well, not attributes. */
function copyScroll(from: HTMLElement, to: HTMLElement): void {
  const sources = [from, ...from.querySelectorAll<HTMLElement>('*')]
  const targets = [to, ...to.querySelectorAll<HTMLElement>('*')]

  sources.forEach((source, idx) => {
    const target = targets[idx]
    if (!target || (!source.scrollTop && !source.scrollLeft)) return

    target.scrollTop = source.scrollTop
    target.scrollLeft = source.scrollLeft
  })
}

/**
 * Copying stops being worth it somewhere: a select with thousands of options
 * costs as much to clone as to keep, and the whole point of a copy is that it
 * is cheap. Cells above this size simply do not get one.
 */
export const DEFAULT_MAX_SNAPSHOT_NODES = 400

export function countNodes(node: HTMLElement): number {
  return 1 + node.querySelectorAll('*').length
}

/**
 * An inert copy of the live node: it looks the same but carries no listeners
 * and no framework bindings, so it costs next to nothing.
 */
export function createSnapshot(
  live: HTMLElement,
  maxNodes: number = DEFAULT_MAX_SNAPSHOT_NODES,
): HTMLElement | null {
  if (countNodes(live) > maxNodes) return null

  const clone = live.cloneNode(true) as HTMLElement

  copyFieldState(live, clone)
  copyScroll(live, clone)
  clone.setAttribute(SNAPSHOT_ATTR, '')

  return clone
}

export function isSnapshot(node: Element | null | undefined): boolean {
  return Boolean(node?.hasAttribute(SNAPSHOT_ATTR))
}
