<script setup lang="ts">
const route = useRoute()
const { restore } = useTheme()
const { restore: restoreLocale, t } = useI18n()

// описание задаётся здесь, а не в nuxt.config: там его пришлось бы вписать
// на одном языке, а язык выбирается уже в браузере
useHead({ meta: [{ name: 'description', content: () => t('app.description') }] })

onMounted(() => {
  restore()
  restoreLocale()
})
</script>

<template>
  <div class="shell">
    <TopNav v-if="route.path !== '/login'" />
    <main class="page">
      <slot />
    </main>
  </div>
</template>
