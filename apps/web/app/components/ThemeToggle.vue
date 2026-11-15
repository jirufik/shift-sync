<script setup lang="ts">
import { PALETTES } from '~/composables/useTheme'

/**
 * Язык, свет и гамма — строками выпадающего меню шапки.
 *
 * Отдельным компонентом, а не внутри шапки: `display: contents` ставит строки
 * прямо в поток меню, и заводить внутри меню ещё одно меню ради гамм незачем —
 * строки те же, что у соседей.
 */
const { mode, palette, cycleTheme, setPalette } = useTheme()
const { locale, apply: applyLocale, t } = useI18n()

/** Языков два, поэтому переключатель — кнопка, а не список. */
function toggleLocale(): void {
  applyLocale(locale.value === 'ru' ? 'en' : 'ru')
}

const themeIcon = computed(() => ({ system: 'contrast', light: 'sun', dark: 'moon' })[mode.value])
</script>

<template>
  <!-- `display: contents`: строки встают в поток меню, а не отдельной коробкой -->
  <div class="rows">
    <button class="row-item" type="button" @click="toggleLocale">
      <span class="grow">{{ t('nav.language') }}</span>
      <span class="mark">{{ locale === 'ru' ? 'RU' : 'EN' }}</span>
    </button>
    <button class="row-item" type="button" @click="cycleTheme">
      <span class="grow">{{ t('nav.theme') }}</span>
      <span class="mark"><AppIcon :name="themeIcon" :size="13" /> {{ t(`theme.${mode}`) }}</span>
    </button>
    <button
      v-for="item in PALETTES"
      :key="item.key"
      class="row-item"
      :class="{ 'row-item--on': palette === item.key }"
      type="button"
      @click="setPalette(item.key)"
    >
      <span class="swatch" :data-palette="item.key"><i /><i /><i /></span>
      <span class="grow">{{ t(item.label) }}</span>
      <AppIcon v-if="palette === item.key" name="check" :size="13" />
    </button>
  </div>
</template>

<style scoped>
.rows {
  display: contents;
}
.row-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.42rem 0.55rem;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-size: 0.86rem;
  text-align: left;
  cursor: pointer;
}
.row-item:hover {
  background: var(--sunk);
  color: var(--ink);
}
.row-item--on {
  background: var(--accent-bg);
  color: var(--accent-ink);
  font-weight: 600;
}
.row-item .grow {
  flex: 1;
}
.mark {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--ink-3);
}
.row-item--on .mark {
  color: inherit;
}

/*
 * Образец гаммы: три её опорных цвета. Атрибут data-palette на самом образце
 * подхватывает те же переменные, что и вся страница, — отдельного списка
 * цветов для превью не заводится.
 */
.swatch {
  display: inline-flex;
  gap: 2px;
  flex: none;
  padding: 3px;
  border-radius: var(--radius-xs);
  background: var(--surface);
  border: 1px solid var(--line);
}
.swatch i {
  width: 6px;
  height: 14px;
  border-radius: 2px;
}
.swatch i:nth-child(1) {
  background: var(--accent);
}
.swatch i:nth-child(2) {
  background: var(--accent-2);
}
.swatch i:nth-child(3) {
  background: var(--ok);
}
</style>
