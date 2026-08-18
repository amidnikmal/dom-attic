/**
 * Path to a node inside a subtree, as a chain of child indices.
 * A snapshot is structurally identical to the live node, so the path carries over.
 */
export function pathTo(root: HTMLElement, target: Element): number[] | null {
  const path: number[] = []
  let node: Element | null = target

  while (node && node !== root) {
    const parent: Element | null = node.parentElement
    if (!parent) return null

    path.unshift([...parent.children].indexOf(node))
    node = parent
  }

  return node === root ? path : null
}

/** The twin node at the same path in a structurally identical subtree. */
export function nodeByPath(root: HTMLElement, path: number[]): HTMLElement | null {
  return path.reduce<HTMLElement | null>(
    (node, idx) => (node?.children[idx] as HTMLElement | undefined) ?? null,
    root,
  )
}

/**
 * Repeats the user action on the revived node.
 * Without it the first press is lost along with the removed snapshot:
 * the browser never delivers click to an element that left the document.
 */
export function replayOn(twin: HTMLElement, sourceType: string): void {
  if (sourceType === 'focusin') {
    twin.focus()
    return
  }

  if (typeof twin.focus === 'function') twin.focus({ preventScroll: true })
  twin.click()
}
