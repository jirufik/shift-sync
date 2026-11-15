<script setup lang="ts">
import type { ImportBatchDto, ImportStatus } from '@fc/contracts'

const api = useApi()
const { t, locale, message } = useI18n()
const { data: batches, pending, error } = await useAsyncData('history', () =>
  api.get<ImportBatchDto[]>('/imports'),
)

/** Плашка статуса: подпись из словаря, цвет — по смыслу. */
const CHIP: Record<ImportStatus, string> = {
  pending: 'chip--mute',
  recognizing: 'chip--info',
  review: 'chip--warn',
  applying: 'chip--info',
  applied: 'chip--ok',
  failed: 'chip--bad',
  cancelled: 'chip--mute',
}

// формат даты берётся из языка интерфейса: 30.08 против 30/08
const fmt = (iso: string) =>
  new Date(iso).toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
</script>

<template>
  <div>
    <h1>{{ t('history.title') }}</h1>
    <p class="lede">{{ t('history.lede') }}</p>

    <p v-if="pending" class="muted"><span class="spinner" /> {{ t('common.loading') }}</p>
    <div v-else-if="error" class="alert alert--bad">{{ message(apiError(error)) }}</div>
    <div v-else-if="!batches?.length" class="card muted">{{ t('history.empty') }}</div>

    <NuxtLink
      v-for="batch in batches"
      :key="batch.id"
      :to="`/imports/${batch.id}`"
      class="card card--link"
    >
      <div class="row row--between">
        <span class="mono">{{ fmt(batch.createdAt) }}</span>
        <span class="chip" :class="CHIP[batch.status]">{{ t(`status.${batch.status}`) }}</span>
      </div>
      <div class="tiny note">
        {{ t('history.frames', { count: batch.screenshots.length }) }}
        <template v-if="batch.sourceMonth">
          · {{ t('history.month', { month: batch.sourceMonth.slice(0, 7) }) }}
        </template>
      </div>
      <div v-if="batch.error" class="tiny note note--bad">{{ message(batch.error) }}</div>
    </NuxtLink>
  </div>
</template>

<style scoped>
.note {
  margin-top: 0.35rem;
}
.note--bad {
  color: var(--bad-ink);
}
</style>
