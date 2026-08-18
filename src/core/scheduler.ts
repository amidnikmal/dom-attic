/** Hand control back to the browser so long work does not freeze the tab. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 50 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** Walk a collection in chunks, yielding between them. */
export async function runChunked<T>(
  items: Iterable<T>,
  action: (item: T) => void,
  chunkSize = 500,
  shouldStop?: () => boolean,
): Promise<void> {
  let processed = 0

  for (const item of items) {
    if (shouldStop?.()) return

    action(item)

    if (++processed % chunkSize === 0) await yieldToBrowser()
  }
}
