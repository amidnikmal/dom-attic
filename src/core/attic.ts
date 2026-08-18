import { createSnapshot, isSnapshot } from './snapshot'
import type { AtticOptions, AtticStats, CellKey, CellRecord } from './types'

export const KEY_ATTR = 'data-attic-key'

/**
 * Хранилище живых узлов и реестр ячеек.
 *
 * Идея: тяжёлый компонент монтируется один раз и больше никогда не
 * пересоздаётся. Когда он не нужен, его DOM-узел уезжает в detached-контейнер
 * (там нет ни layout, ни paint, но компонент жив и продолжает получать
 * обновления), а на его месте остаётся инертный снимок.
 */
export class Attic {
  private readonly storage = document.createElement('div')
  private readonly cells = new Map<CellKey, CellRecord>()
  /** Порядок вставки = порядок вытеснения. */
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

  /** Взять ячейку под управление. Хост уже содержит смонтированный узел. */
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

  /** Ключ ячейки, которой принадлежит элемент. */
  keyOf(node: Element): CellKey | null {
    return node.closest(`[${KEY_ATTR}]`)?.getAttribute(KEY_ATTR) ?? null
  }

  /** Увести живой узел в хранилище, оставив на его месте свежий снимок. */
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

  /** Вернуть живой узел в документ, вытеснив самые давние сверх лимита. */
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
   * Данные ячейки изменились. Живой узел фреймворк обновит сам, даже в
   * хранилище, а вот снимок протух и подлежит пересъёмке.
   */
  markDirty(key: CellKey): void {
    const cell = this.cells.get(key)
    if (cell?.state === 'parked') cell.dirty = true
  }

  /** Пересобрать снимок ячейки по текущему состоянию живого узла. */
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

  /** Вернуть все узлы в документ: фреймворк должен размонтировать их сам. */
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
