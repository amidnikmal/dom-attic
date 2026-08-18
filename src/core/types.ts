/** Cell key, unique within a single attic. */
export type CellKey = string

export type CellState = 'live' | 'parked'

export interface AtticOptions {
  /** How many live nodes may sit in the document at once. */
  liveLimit?: number
  /** Whether to replay the original event on the revived node. */
  replayEvents?: boolean
  /** Called when a cell is evicted by the limit. */
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
  /** Container holding either the live node or a snapshot. */
  host: HTMLElement
  /** The live node: in the document while state is live, in storage otherwise. */
  live: HTMLElement | null
  state: CellState
  dirty: boolean
}
