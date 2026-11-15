<script setup lang="ts">
/**
 * Набор значков — контурные, одной толщиной, наследуют цвет текста.
 *
 * Своей горсткой путей вместо библиотеки: их полдюжины, и тащить ради этого
 * зависимость с тысячей значков незачем (та же причина, что у D-010).
 *
 * Значки нарисованы, а не набраны символами, ещё и потому, что подписанные
 * глифы (`☀`, `☾`, `✓`, `▾`) не входят в подмножество Inter, которое мы
 * раздаём (D-022): они уехали бы в системный шрифт, а где-то и в пустой
 * квадрат.
 */
const PATHS: Record<string, string> = {
  upload: 'M12 15V3M8 7l4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2M14 4v4M8 10v4M14 16v4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  contrast: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 3v18',
  check: 'M4 12l5 5L20 6',
  caret: 'M6 9l6 6 6-6',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  arrow: 'M4 12h15l-5-5M19 12l-5 5',
  expand: 'M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5',
  edit: 'M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4Z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  file: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4ZM14 3v4h4',
}

withDefaults(defineProps<{ name: keyof typeof PATHS | string; size?: number }>(), { size: 16 })
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <!-- «полукруг» темы залит наполовину, у остальных заливки нет -->
    <path v-if="name === 'contrast'" d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    <path :d="PATHS[name] ?? PATHS.contrast" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
  vertical-align: -0.15em;
}
</style>
