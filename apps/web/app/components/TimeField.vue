<script setup lang="ts">
/**
 * Ввод времени двумя списками: часы 00–23 и минуты.
 *
 * Почему не `input[type=time]`: Chrome рисует его по языку интерфейса
 * браузера, а не страницы. При английском Chrome получается AM/PM, и никакой
 * `lang` на это не влияет. Списки 24-часовые всегда, а на телефоне
 * открываются родным барабаном — попадать пальцем удобнее.
 */
const model = defineModel<string>({ required: true })
const props = defineProps<{ label: string }>()

const { t } = useI18n()

const pad = (n: number) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i))
/** Шаг 5 минут покрывает любую смену; значение вне сетки не теряем. */
const STEP = 5

const hh = computed(() => model.value.slice(0, 2))
const mm = computed(() => model.value.slice(3, 5))

const minutes = computed(() => {
  const grid = Array.from({ length: 60 / STEP }, (_, i) => pad(i * STEP))
  return grid.includes(mm.value) ? grid : [...grid, mm.value].sort()
})
</script>

<template>
  <span class="timefield">
    <span class="timefield__label tiny">{{ label }}</span>
    <span class="timefield__controls">
      <select
        class="mono"
        :aria-label="t('time.hours', { label: props.label })"
        :value="hh"
        @change="model = `${($event.target as HTMLSelectElement).value}:${mm}`"
      >
        <option v-for="h in HOURS" :key="h" :value="h">{{ h }}</option>
      </select>
      <span class="timefield__sep" aria-hidden="true">:</span>
      <select
        class="mono"
        :aria-label="t('time.minutes', { label: props.label })"
        :value="mm"
        @change="model = `${hh}:${($event.target as HTMLSelectElement).value}`"
      >
        <option v-for="m in minutes" :key="m" :value="m">{{ m }}</option>
      </select>
    </span>
  </span>
</template>
