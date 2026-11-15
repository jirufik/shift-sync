<script setup lang="ts">
/**
 * Единственная полоса навигации.
 *
 * Разделов два — этого мало, чтобы прятать их под «Ещё», и они стоят в строку
 * пилюлями. А вот служебное (язык, тема, четыре гаммы, выход) — это семь
 * строк, и семью кнопками в ту же полосу оно не помещается даже на широком
 * экране, не говоря о телефоне. Всё служебное собрано под шестерёнкой одним
 * списком.
 */
const route = useRoute()
const { logout } = useAuth()
const { t } = useI18n()

const SECTIONS: Array<{ to: string; key: string; icon: string }> = [
  { to: '/', key: 'nav.upload', icon: 'upload' },
  { to: '/history', key: 'nav.history', icon: 'clock' },
]

/**
 * Какой раздел открыт.
 *
 * Сравнение по самому длинному совпавшему пути: у загрузки путь `/`, и он
 * совпал бы с любым другим разделом.
 */
const current = computed(() => {
  const matched = SECTIONS.filter(
    (section) => route.path === section.to || route.path.startsWith(`${section.to}/`),
  )
  return matched.sort((a, b) => b.to.length - a.to.length)[0] ?? null
})

const open = ref(false)
const close = (): void => {
  open.value = false
}

watch(() => route.path, close)
onMounted(() => window.addEventListener('keydown', onEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape))
function onEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}
</script>

<template>
  <header class="bar">
    <NuxtLink to="/" class="brand">{{ t('app.name') }}</NuxtLink>

    <nav class="bar__sections">
      <NuxtLink
        v-for="section in SECTIONS"
        :key="section.to"
        class="pill"
        :class="{ 'pill--on': section === current }"
        :to="section.to"
      >
        <AppIcon :name="section.icon" :size="14" />
        <span class="pill__label">{{ t(section.key) }}</span>
      </NuxtLink>
    </nav>

    <span class="grow" />

    <!-- ── служебное: язык, тема, гаммы, выход ────────────────────────── -->
    <div class="drop">
      <button
        class="gear"
        type="button"
        :title="t('nav.settings')"
        :aria-label="t('nav.settings')"
        :aria-expanded="open"
        @click="open = !open"
      >
        <AppIcon name="sliders" :size="16" />
      </button>
      <template v-if="open">
        <!-- подложка ловит клик мимо меню; на телефоне это единственный
             способ закрыть его, не выбрав ничего -->
        <div class="scrim" @click="close" />
        <div class="menu menu--wide">
          <ThemeToggle />
          <hr>
          <button class="menu__item" type="button" @click="logout">{{ t('nav.logout') }}</button>
        </div>
      </template>
    </div>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 46px;
  padding: 0.4rem 1.25rem;
  padding-top: max(0.4rem, env(safe-area-inset-top));
  background: color-mix(in oklab, var(--bg) 82%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--line-soft);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.92rem;
  letter-spacing: -0.03em;
  color: var(--ink);
  text-decoration: none;
  flex: none;
}

.grow {
  flex: 1;
}

.bar__sections {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  min-width: 0;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 30px;
  padding: 0 0.6rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.pill:hover {
  background: var(--sunk);
  color: var(--ink);
}
.pill--on {
  background: var(--accent-bg);
  color: var(--accent-ink);
  font-weight: 600;
}
/* название раздела сжимается до многоточия: строка из nowrap-кнопок иначе
   не ужимается, и шестерёнка уезжает за край узкого экрана */
.pill__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.gear {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.gear:hover {
  background: var(--sunk);
  color: var(--ink);
  border-color: color-mix(in oklab, var(--accent) 35%, var(--line));
}

/* ── выпадающий список ──────────────────────────────────────────────── */
.drop {
  position: relative;
  flex: none;
}
.scrim {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  z-index: 21;
  min-width: 13rem;
  padding: 0.35rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lift);
}
.menu--wide {
  left: auto;
  right: 0;
  min-width: 15rem;
}
.menu hr {
  border: 0;
  border-top: 1px solid var(--line-soft);
  margin: 0.3rem 0;
}
.menu__item {
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
  text-decoration: none;
  cursor: pointer;
}
.menu__item:hover {
  background: var(--sunk);
  color: var(--ink);
}

@media (max-width: 46rem) {
  .bar {
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    padding-top: max(0.35rem, env(safe-area-inset-top));
  }
  .brand {
    font-size: 0.85rem;
  }
  .bar__sections {
    min-width: 0;
    flex: 0 1 auto;
  }
  .menu {
    /* на узком экране список во всю ширину, а не колонкой у края */
    position: fixed;
    left: 0;
    right: 0;
    top: auto;
    margin: 0.35rem 0.7rem;
    min-width: 0;
  }
}
</style>
