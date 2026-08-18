<template>
  <div class="heavy-cell">
    <button data-testid="inc" @click="local++">+</button>
    <span data-testid="local">{{ local }}</span>
    <span data-testid="model">{{ modelValue }}</span>
    <select>
      <option v-for="option in options" :key="option" :value="option">{{ option }}</option>
    </select>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'

defineProps<{ modelValue: number }>()

/** Внутреннее состояние: обязано пережить park/revive. */
const local = ref(0)

/** Имитация тяжести: столько опций монтировать дорого. */
const options = Array.from({ length: 500 }, (_, idx) => idx)
</script>

<style>
.heavy-cell {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 2px;
  font: 12px monospace;
}

.attic-cell > :not([data-attic-snapshot]) {
  outline: 2px solid green;
}
</style>
