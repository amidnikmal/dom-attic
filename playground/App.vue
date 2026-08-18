<template>
  <div>
    <p data-testid="stats">
      registered: {{ stats.registered }} · live: {{ stats.live }} · parked: {{ stats.parked }}
    </p>

    <button data-testid="bump" @click="bump">external data (+1)</button>

    <div ref="rootRef" class="grid">
      <AtticCell
        v-for="cell in cells"
        :key="cell.key"
        :cell-key="cell.key"
        :revision="cell.value"
        :data-testid="`cell-${cell.key}`"
        @vue:mounted="refreshStats"
      >
        <HeavyCell :model-value="cell.value" />
      </AtticCell>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { AtticCell, useAtticRoot } from '../src/adapters/vue/index'
import { reactive, watch } from 'vue'

import HeavyCell from './HeavyCell.vue'

const { rootRef, stats, refreshStats, attic } = useAtticRoot({ liveLimit: 2 })

const cells = reactive(
  Array.from({ length: 30 }, (_, idx) => ({ key: `cell-${idx}`, value: 0 })),
)

function bump() {
  cells.forEach((cell) => { cell.value += 1 })
}

watch(() => attic.stats.live, refreshStats)
document.addEventListener('pointerdown', () => queueMicrotask(refreshStats), true)
</script>

<style>
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
</style>
