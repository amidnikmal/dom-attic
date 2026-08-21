export const SNAPSHOT_ATTR = 'data-attic-snapshot'

/**
 * Copying stops being worth it somewhere, so a copy is capped by the number of
 * nodes it produces — not by the size of the original, which may be mostly
 * invisible anyway.
 */
export const DEFAULT_MAX_SNAPSHOT_NODES = 400

/**
 * Asking an element for its boxes is cheap once and ruinous ten thousand times
 * over, so a parent with a crowd of children is judged by the cheap signs
 * alone: whatever is marked as chosen stays, the rest is skipped unseen.
 */
export const DEFAULT_MAX_MEASURED_CHILDREN = 200

/** An element that produces no boxes is not on screen and need not be copied. */
function isRendered(element: Element): boolean {
  return element.getClientRects().length > 0
}

/**
 * Some nodes draw nothing themselves yet decide what their parent shows — the
 * chosen entry of a list, a ticked box, an opened section. They are kept even
 * though they are invisible, because dropping them changes the picture.
 */
function isActive(element: Element): boolean {
  const state = element as Partial<HTMLOptionElement & HTMLInputElement & HTMLDetailsElement>

  return Boolean(state.selected || state.checked || state.open)
}

/** Properties cloneNode leaves behind: they do not live in attributes. */
function copyState(from: Element, to: Element): void {
  const source = from as Partial<HTMLInputElement & HTMLOptionElement>
  const target = to as Partial<HTMLInputElement & HTMLOptionElement>

  // Only what the clone did not already get: assigning an unchanged value
  // would spell it out as an attribute the original never had.
  if (source.value !== undefined && source.value !== target.value) target.value = source.value
  if (source.checked !== undefined && source.checked !== target.checked) {
    target.checked = source.checked
  }
  if (source.selected !== undefined && source.selected !== target.selected) {
    target.selected = source.selected
  }

  const scrolled = from as HTMLElement
  const landing = to as HTMLElement
  if (scrolled.scrollTop) landing.scrollTop = scrolled.scrollTop
  if (scrolled.scrollLeft) landing.scrollLeft = scrolled.scrollLeft
}

/**
 * Copies a subtree, keeping what is visible and skipping what is not.
 *
 * A heavy component is usually heavy in its hidden parts: a list of thousands
 * of entries shows one of them, a virtualized panel holds a window of rows.
 * Walking past those makes the copy cheap without making it look different.
 */
function copyVisible(node: Element, budget: { left: number }, all: boolean): Element | null {
  if (budget.left <= 0) return null

  budget.left--
  const copy = node.cloneNode(false) as Element
  copyState(node, copy)

  const crowded = node.childElementCount > DEFAULT_MAX_MEASURED_CHILDREN

  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      copy.append(child.cloneNode(false))
      continue
    }

    if (!(child instanceof Element)) continue

    if (crowded) {
      if (!isActive(child)) continue
    } else if (!all && !isRendered(child) && !isActive(child)) continue

    const branch = copyVisible(child, budget, all)
    if (!branch) return copy

    copy.append(branch)
  }

  return copy
}

/**
 * An inert copy of the live node: it looks the same but carries no listeners
 * and no framework bindings, so it costs next to nothing.
 */
export function createSnapshot(
  live: HTMLElement,
  maxNodes: number = DEFAULT_MAX_SNAPSHOT_NODES,
): HTMLElement | null {
  const budget = { left: maxNodes }

  // Visibility only tells us anything while the node itself is on screen. A
  // node already put away has nothing visible in it, so it is copied whole.
  const copy = copyVisible(live, budget, !isRendered(live))

  // The budget ran out mid-way, so the copy is a torn version of the original
  // and showing it would be worse than showing nothing.
  if (!copy || budget.left <= 0) return null

  copy.setAttribute(SNAPSHOT_ATTR, '')

  return copy as HTMLElement
}

export function isSnapshot(node: Element | null | undefined): boolean {
  return Boolean(node?.hasAttribute(SNAPSHOT_ATTR))
}

export function countNodes(node: HTMLElement): number {
  return 1 + node.querySelectorAll('*').length
}
