/**
 * Путь до узла внутри поддерева: цепочка индексов среди детей.
 * Снимок структурно идентичен живому узлу, поэтому путь переносим между ними.
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

/** Узел-близнец по тому же пути в структурно идентичном поддереве. */
export function nodeByPath(root: HTMLElement, path: number[]): HTMLElement | null {
  return path.reduce<HTMLElement | null>(
    (node, idx) => (node?.children[idx] as HTMLElement | undefined) ?? null,
    root,
  )
}

/**
 * Повторяет действие пользователя на оживлённом узле.
 * Без этого первое нажатие теряется вместе с удалённым снимком:
 * браузер не доводит click до элемента, покинувшего документ.
 */
export function replayOn(twin: HTMLElement, sourceType: string): void {
  if (sourceType === 'focusin') {
    twin.focus()
    return
  }

  if (typeof twin.focus === 'function') twin.focus({ preventScroll: true })
  twin.click()
}
