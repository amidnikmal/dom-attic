import {
  defineComponent,
  h,
  inject,
  type InjectionKey,
  onBeforeUnmount,
  onMounted,
  provide,
  type Ref,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { attachInteraction, Attic, type AtticOptions, type AtticStats, yieldToBrowser } from '../../core/index'

const ATTIC_KEY: InjectionKey<Attic> = Symbol('attic')

export interface UseAtticRoot {
  attic: Attic
  /** Навесить на контейнер, внутри которого живут ячейки. */
  rootRef: Ref<HTMLElement | undefined>
  stats: Ref<AtticStats>
  refreshStats: () => void
}

/**
 * Создаёт attic на текущий компонент и раздаёт его вложенным ячейкам.
 * Перехват взаимодействий вешается на rootRef одним слушателем.
 */
export function useAtticRoot(options: AtticOptions = {}): UseAtticRoot {
  const attic = new Attic(options)
  const rootRef = ref<HTMLElement>()
  const stats = shallowRef<AtticStats>(attic.stats)

  const refreshStats = () => {
    stats.value = attic.stats
  }

  provide(ATTIC_KEY, attic)

  let detach: (() => void) | undefined

  onMounted(() => {
    if (rootRef.value) detach = attachInteraction(attic, rootRef.value)
  })

  onBeforeUnmount(() => {
    detach?.()
    attic.dispose()
  })

  return { attic, rootRef, stats, refreshStats }
}

export function useAttic(): Attic {
  const attic = inject(ATTIC_KEY)
  if (!attic) throw new Error('[dom-attic] useAttic must be used inside useAtticRoot')

  return attic
}

/**
 * Обёртка ячейки: её корневой элемент — тот самый host, содержимое которого
 * подменяется снимком. Содержимое слота монтируется один раз.
 */
export const AtticCell = defineComponent({
  name: 'AtticCell',
  props: {
    cellKey: { type: String, required: true },
    /** Убрать в хранилище сразу после монтирования. */
    parkOnMount: { type: Boolean, default: true },
    /** Любое значение, меняющееся вместе с данными ячейки: снимок пересобирается. */
    revision: { type: [String, Number], default: 0 },
  },
  setup(props, { slots }) {
    const attic = useAttic()
    const hostRef = ref<HTMLElement>()

    onMounted(async () => {
      if (!hostRef.value) return

      attic.register(props.cellKey, hostRef.value)
      if (props.parkOnMount) attic.park(props.cellKey)
    })

    onBeforeUnmount(() => attic.unregister(props.cellKey))

    watch(
      () => props.revision,
      async () => {
        attic.markDirty(props.cellKey)
        // Живой узел уже пропатчен фреймворком — остаётся переснять снимок.
        await yieldToBrowser()
        attic.refresh(props.cellKey)
      },
      { flush: 'post' },
    )

    return () => h('div', { ref: hostRef, class: 'attic-cell' }, slots.default?.())
  },
})
