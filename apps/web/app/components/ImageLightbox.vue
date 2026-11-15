<script setup lang="ts">
/**
 * Просмотр кадра во весь экран. По умолчанию кадр вписан в окно; клик по нему
 * переключает на реальный размер со скроллом — мелкие цифры в колонке времени
 * иначе не разобрать. Esc закрывает, ← → листают.
 */
const props = defineProps<{ sources: string[] }>()
const index = defineModel<number | null>({ required: true })

const { t } = useI18n()

const natural = ref(false)

const total = computed(() => props.sources.length)
const src = computed(() => (index.value === null ? '' : (props.sources[index.value] ?? '')))

function close() {
  index.value = null
}

function step(delta: number) {
  if (index.value === null || total.value < 2) return
  index.value = (index.value + delta + total.value) % total.value
}

function onKey(event: KeyboardEvent) {
  if (index.value === null) return
  const handled: Record<string, () => void> = {
    Escape: close,
    ArrowRight: () => step(1),
    ArrowLeft: () => step(-1),
  }
  const action = handled[event.key]
  if (!action) return
  event.preventDefault()
  action()
}

// каждый новый кадр показываем вписанным, иначе окно открывается прокрученным
watch(index, (value) => {
  natural.value = false
  document.body.style.overflow = value === null ? '' : 'hidden'
})

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="index !== null" class="lightbox">
      <div class="lightbox__bar">
        <span class="mono lightbox__count">{{ (index ?? 0) + 1 }} / {{ total }}</span>
        <button class="btn btn--small" type="button" @click="natural = !natural">
          <AppIcon name="expand" :size="13" />
          {{ natural ? t('lightbox.fit') : t('lightbox.natural') }}
        </button>
        <button class="btn btn--small" type="button" @click="close">
          <AppIcon name="close" :size="13" />
          {{ t('common.close') }}
        </button>
      </div>

      <div class="lightbox__stage" @click.self="close">
        <img
          :src="src"
          :class="['lightbox__img', natural && 'lightbox__img--natural']"
          :title="natural ? t('lightbox.fit') : t('lightbox.natural')"
          :alt="t('lightbox.alt')"
          @click="natural = !natural"
        >
      </div>

      <template v-if="total > 1">
        <button
          class="btn lightbox__nav lightbox__nav--prev"
          type="button"
          :aria-label="t('lightbox.prev')"
          @click="step(-1)"
        >
          <AppIcon name="left" :size="18" />
        </button>
        <button
          class="btn lightbox__nav lightbox__nav--next"
          type="button"
          :aria-label="t('lightbox.next')"
          @click="step(1)"
        >
          <AppIcon name="right" :size="18" />
        </button>
      </template>
    </div>
  </Teleport>
</template>
