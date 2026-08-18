/** Ключ ячейки: уникален в пределах одного attic. */
export type CellKey = string

export type CellState = 'live' | 'parked'

export interface AtticOptions {
  /** Сколько живых узлов одновременно допускается в документе. */
  liveLimit?: number
  /** Повторять ли исходное событие на оживлённом узле. */
  replayEvents?: boolean
  /** Вызывается, когда ячейка вытеснена лимитом. */
  onEvict?: (key: CellKey) => void
}

export interface AtticStats {
  registered: number
  live: number
  parked: number
  parks: number
  revives: number
}

export interface CellRecord {
  key: CellKey
  /** Контейнер, в котором лежит либо живой узел, либо снимок. */
  host: HTMLElement
  /** Живой узел: в документе, если состояние live, иначе в хранилище. */
  live: HTMLElement | null
  state: CellState
  dirty: boolean
}
