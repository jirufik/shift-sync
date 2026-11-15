<script setup lang="ts">
import type { ImportBatchDto, Message } from '@fc/contracts'

const api = useApi()
const router = useRouter()
const { t, message } = useI18n()

interface Picked {
  file: File
  /** ссылка на превью; у PDF картинки нет — показываем имя файла */
  url: string | null
}

const picked = ref<Picked[]>([])
const busy = ref(false)
const over = ref(false)
const error = ref<Message | string | null>(null)

/** Два входа в один конвейер: снимки экрана и выгрузка графика в PDF. */
function isSupported(file: File) {
  return file.type.startsWith('image/') || isPdf(file)
}

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function take(files: File[]) {
  revoke()
  picked.value = files.map((file) => ({
    file,
    url: isPdf(file) ? null : URL.createObjectURL(file),
  }))
  error.value = null
}

function revoke() {
  for (const item of picked.value) if (item.url) URL.revokeObjectURL(item.url)
}

function pick(event: Event) {
  take(Array.from((event.target as HTMLInputElement).files ?? []))
}

function drop(event: DragEvent) {
  over.value = false
  const files = Array.from(event.dataTransfer?.files ?? []).filter(isSupported)
  if (files.length) take(files)
}

async function upload() {
  if (!picked.value.length) return
  busy.value = true
  error.value = null
  try {
    const form = new FormData()
    for (const item of picked.value) form.append('files', item.file)
    const batch = await api.upload<ImportBatchDto>('/imports', form)
    await router.push(`/imports/${batch.id}`)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(revoke)
</script>

<template>
  <div>
    <h1>{{ t('upload.title') }}</h1>
    <p class="lede">{{ t('upload.lede') }}</p>

    <div v-if="error" class="alert alert--bad">{{ message(error) }}</div>

    <label
      class="card card--drop"
      :class="{ 'card--drop--over': over }"
      @dragover.prevent="over = true"
      @dragleave="over = false"
      @drop.prevent="drop"
    >
      <input type="file" accept="image/*,application/pdf,.pdf" multiple hidden @change="pick">
      <div class="drop">
        <div class="drop__title">{{ t('upload.pick') }}</div>
        <div class="tiny">{{ t('upload.pickHint') }}</div>
      </div>
    </label>

    <template v-if="picked.length">
      <p class="muted picked">{{ t('upload.picked', { count: picked.length }) }}</p>
      <div class="previews">
        <img v-for="item in picked.filter((p) => p.url)" :key="item.url!" :src="item.url!" alt="">
        <span v-for="item in picked.filter((p) => !p.url)" :key="item.file.name" class="previews__file">
          <AppIcon name="file" :size="20" />
          <span class="previews__name">{{ t('upload.pdfFile') }}</span>
        </span>
      </div>
    </template>

    <button
      class="btn btn--primary btn--wide submit"
      :disabled="!picked.length || busy"
      @click="upload"
    >
      <span v-if="busy" class="spinner" />
      <AppIcon v-else name="upload" :size="14" />
      {{ t('upload.submit') }}
    </button>
  </div>
</template>

<style scoped>
.drop {
  padding: 1.25rem 0;
  /* иначе перетаскивание над содержимым метки считается уходом с неё,
     и подсветка зоны мигает под курсором */
  pointer-events: none;
}
.drop__title {
  font-weight: 600;
  margin-bottom: 0.25rem;
}
.picked {
  margin: 1rem 0 0;
}
.submit {
  margin-top: 1rem;
}
</style>
