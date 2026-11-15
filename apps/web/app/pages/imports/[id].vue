<script setup lang="ts">
import type {
  ApplyImportResultDto,
  DiffAction,
  DiffEntryDto,
  ImportBatchDetailDto,
  ImportStatus,
  Message,
} from '@fc/contracts'

const api = useApi()
const route = useRoute()
const { t, locale, message } = useI18n()
const id = route.params.id as string

const batch = ref<ImportBatchDetailDto | null>(null)
const error = ref<Message | string | null>(null)
const busy = ref(false)
const applied = ref<ApplyImportResultDto | null>(null)
const selected = ref<Set<string>>(new Set())
const editing = ref<string | null>(null)
const editStart = ref('')
const editEnd = ref('')
const showShots = ref(false)
const lightbox = ref<number | null>(null)
const confirming = ref(false)

let timer: ReturnType<typeof setTimeout> | null = null

/** Плашка действия: подпись из словаря, цвет — по смыслу. */
const CHIP: Record<DiffAction, string> = {
  create: 'chip--ok',
  update: 'chip--info',
  delete: 'chip--bad',
  skip_identical: 'chip--mute',
  skip_invalid: 'chip--warn',
}

const CHANGING: DiffAction[] = ['create', 'update', 'delete']

/**
 * Заголовок зависит от того, чем импорт кончился.
 *
 * «Проверка перед записью» над применённым импортом — неправда: проверять
 * больше нечего и записывать тоже. Пока идёт распознавание, заголовок
 * остаётся прежним: страница вот-вот станет ревью.
 */
const HEAD: Record<ImportStatus, { title: string; lede: string }> = {
  pending: { title: 'review.title', lede: 'review.lede' },
  recognizing: { title: 'review.title', lede: 'review.lede' },
  review: { title: 'review.title', lede: 'review.lede' },
  applying: { title: 'review.title', lede: 'review.lede' },
  applied: { title: 'review.titleDone', lede: 'review.ledeDone' },
  failed: { title: 'review.titleFailed', lede: 'review.ledeFailed' },
  cancelled: { title: 'review.titleCancelled', lede: 'review.ledeCancelled' },
}

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
  // getUTCDay считает от воскресенья, словарь — от понедельника, как в ISO
  return `${t(`weekday.${weekday === 0 ? 7 : weekday}`)} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
}

const entries = computed(() => batch.value?.plan?.entries ?? [])
const summary = computed(() => batch.value?.plan?.summary ?? null)
const isWorking = computed(() =>
  ['pending', 'recognizing', 'applying'].includes(batch.value?.status ?? ''),
)
const inReview = computed(() => batch.value?.status === 'review')
const head = computed(() => HEAD[batch.value?.status ?? 'review'] ?? HEAD.review)
const changes = (entry: DiffEntryDto) => CHANGING.includes(entry.action)

async function load() {
  try {
    const data = await api.get<ImportBatchDetailDto>(`/imports/${id}`)
    batch.value = data
    // по умолчанию отмечено всё, что прошло проверки; спорное — снято
    if (selected.value.size === 0 && data.plan) {
      selected.value = new Set(
        data.plan.entries
          .filter((e) => !e.needsAttention && CHANGING.includes(e.action))
          .map((e) => e.workDate),
      )
    }
    if (isWorking.value) timer = setTimeout(load, 1200)
  } catch (e) {
    error.value = apiError(e)
  }
}

function toggle(date: string) {
  const next = new Set(selected.value)
  next.has(date) ? next.delete(date) : next.add(date)
  selected.value = next
}

function rowOf(entry: DiffEntryDto) {
  return batch.value?.rows.find((r) => r.id === entry.rowId) ?? null
}

function startEdit(entry: DiffEntryDto) {
  const row = rowOf(entry)
  editStart.value = entry.after?.startsAt ?? row?.startsAt ?? '08:00'
  editEnd.value = entry.after?.endsAt ?? row?.endsAt ?? '16:00'
  editing.value = entry.rowId
}

const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Длительность видно сразу: её же проверяет шлюз, и ошибку в ней легко не заметить. */
const editDuration = computed(() => {
  const total = minutesOf(editEnd.value) - minutesOf(editStart.value)
  if (total <= 0) return null
  return t('time.duration', {
    hours: Math.floor(total / 60),
    minutes: String(total % 60).padStart(2, '0'),
  })
})

const shotSources = computed(() =>
  (batch.value?.screenshots ?? []).map((shot) => `/api/imports/${id}/screenshots/${shot.id}/image`),
)

const failures = computed(() => applied.value?.entries.filter((e) => !e.ok) ?? [])

/**
 * Отменить можно всё, кроме уже применённого: сервер такой запрос отклонит,
 * и предлагать кнопку, которая заведомо откажет, незачем.
 */
const cancellable = computed(() =>
  ['pending', 'recognizing', 'review', 'failed'].includes(batch.value?.status ?? ''),
)

async function cancel() {
  busy.value = true
  error.value = null
  try {
    await api.post(`/imports/${id}/cancel`)
    confirming.value = false
    await load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function saveRow(rowId: string, startsAt: string, endsAt: string) {
  busy.value = true
  error.value = null
  try {
    batch.value = await api.patch<ImportBatchDetailDto>(`/imports/${id}/rows/${rowId}`, {
      startsAt, endsAt, kind: 'shift',
    })
    editing.value = null
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

async function apply() {
  busy.value = true
  error.value = null
  try {
    applied.value = await api.post<ApplyImportResultDto>(`/imports/${id}/apply`, {
      workDates: [...selected.value],
    })
    await load()
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

// дата в сообщении о сбое читается человеком, а не сверяется с базой
const failDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale.value === 'ru' ? 'ru-RU' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  })

onMounted(load)
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
</script>

<template>
  <div>
    <h1>{{ t(head.title) }}</h1>
    <p class="lede">{{ t(head.lede) }}</p>

    <div v-if="error" class="alert alert--bad">{{ message(error) }}</div>

    <div v-if="!batch" class="muted"><span class="spinner" /> {{ t('common.loading') }}</div>

    <template v-else>
      <div v-if="isWorking" class="card row">
        <span class="spinner" />
        <span>{{ batch.status === 'applying' ? t('review.applying') : t('review.recognizing') }}</span>
      </div>

      <!-- то, что распознавание решило само: проверять даты человеку -->
      <div v-for="(note, i) in batch.warnings" :key="i" class="alert alert--warn">
        {{ message(note) }}
      </div>

      <div v-if="batch.status === 'failed'" class="alert alert--bad">
        {{ batch.error ? message(batch.error) : t('review.failed') }}
      </div>

      <div v-if="applied" class="alert" :class="applied.failed ? 'alert--warn' : 'alert--ok'">
        {{
          applied.failed
            ? t('review.writtenFailed', { applied: applied.applied, failed: applied.failed })
            : t('review.written', { applied: applied.applied })
        }}
        <ul v-if="failures.length" class="fails">
          <li v-for="e in failures" :key="e.workDate">
            <span class="mono">{{ failDate(e.workDate) }}</span> — {{ message(e.error) }}
          </li>
        </ul>
      </div>

      <!-- ── план ─────────────────────────────────────────────────────── -->
      <template v-if="entries.length">
        <div
          v-for="entry in entries"
          :key="entry.workDate + entry.action + (entry.rowId ?? '')"
          class="card"
          :class="{ 'card--attention': entry.needsAttention }"
        >
          <div class="row row--top">
            <input
              v-if="changes(entry)"
              type="checkbox"
              class="entry__check"
              :checked="selected.has(entry.workDate)"
              :disabled="!inReview"
              @change="toggle(entry.workDate)"
            >
            <span v-else class="entry__check entry__check--empty" />

            <div class="grow">
              <div class="row row--between">
                <strong class="mono">{{ dayLabel(entry.workDate) }}</strong>
                <span class="chip" :class="CHIP[entry.action]">{{ t(`action.${entry.action}`) }}</span>
              </div>

              <div class="mono entry__times">
                <span :class="{ 'entry__times--faint': !entry.before }">
                  {{ entry.before ? `${entry.before.startsAt}–${entry.before.endsAt}` : t('common.dash') }}
                </span>
                <AppIcon name="arrow" :size="13" class="entry__arrow" />
                <span :class="{ 'entry__times--faint': !entry.after }">
                  {{ entry.after ? `${entry.after.startsAt}–${entry.after.endsAt}` : t('common.dash') }}
                </span>
              </div>

              <div
                v-if="entry.reason"
                class="tiny entry__note"
                :class="{ 'entry__note--warn': entry.needsAttention }"
              >
                {{ message(entry.reason) }}
              </div>

              <div v-if="rowOf(entry)?.usedFallback" class="tiny entry__note">
                {{ t('review.fallback') }}
              </div>

              <!-- правка руками -->
              <div v-if="entry.rowId && inReview" class="entry__edit">
                <button
                  v-if="editing !== entry.rowId"
                  class="btn btn--small"
                  @click="startEdit(entry)"
                >
                  <AppIcon name="edit" :size="13" />
                  {{ t('review.editTime') }}
                </button>
                <form v-else class="edit" @submit.prevent="saveRow(entry.rowId!, editStart, editEnd)">
                  <div class="edit__fields">
                    <TimeField v-model="editStart" :label="t('review.start')" />
                    <span class="edit__dash" aria-hidden="true">–</span>
                    <TimeField v-model="editEnd" :label="t('review.end')" />
                  </div>
                  <p class="tiny edit__hint">
                    <template v-if="editDuration">{{ t('review.duration', { value: editDuration }) }}</template>
                    <span v-else class="edit__bad">{{ t('review.durationInvalid') }}</span>
                  </p>
                  <div class="row">
                    <button class="btn btn--primary" type="submit" :disabled="busy || !editDuration">
                      <span v-if="busy" class="spinner" />
                      <AppIcon v-else name="check" :size="13" />
                      {{ t('common.save') }}
                    </button>
                    <button class="btn" type="button" @click="editing = null">
                      {{ t('common.cancel') }}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="inReview" class="card muted">{{ t('review.noChanges') }}</div>

      <!-- ── итог и применение ────────────────────────────────────────── -->
      <div v-if="summary && inReview && entries.length" class="card summary">
        <div class="tiny summary__counts">
          {{
            t('review.summary', {
              create: summary.create,
              update: summary.update,
              delete: summary.delete,
              identical: summary.skip_identical,
              invalid: summary.skip_invalid,
            })
          }}
        </div>
        <button
          class="btn btn--primary btn--wide"
          :disabled="busy || selected.size === 0"
          @click="apply"
        >
          <span v-if="busy" class="spinner" />
          <AppIcon v-else name="check" :size="14" />
          {{ t('review.apply', { count: selected.size }) }}
        </button>
      </div>

      <!-- ── отмена ───────────────────────────────────────────────────── -->
      <div v-if="cancellable" class="row cancel">
        <button class="btn btn--small btn--danger" type="button" @click="confirming = true">
          <AppIcon name="trash" :size="13" />
          {{ t('review.cancel') }}
        </button>
      </div>

      <!-- ── исходные кадры ───────────────────────────────────────────── -->
      <details class="shots-block" @toggle="showShots = !showShots">
        <summary class="muted">{{ t('review.shots', { count: batch.screenshots.length }) }}</summary>
        <template v-if="showShots">
          <p class="tiny shots-block__hint">{{ t('review.shotsHint') }}</p>
          <div class="shots">
            <button
              v-for="(shot, i) in batch.screenshots"
              :key="shot.id"
              class="shot"
              type="button"
              :aria-label="t('review.shotOpen', { number: i + 1 })"
              @click="lightbox = i"
            >
              <img :src="shotSources[i]" alt="" loading="lazy">
              <span class="shot__zoom"><AppIcon name="expand" :size="13" /></span>
            </button>
          </div>
        </template>
      </details>

      <ImageLightbox v-model="lightbox" :sources="shotSources" />

      <!-- Подтверждение есть, набранного слова нет: отмена ничего не удаляет
           из календаря, теряется только разбор кадров -->
      <template v-if="confirming">
        <div class="modal-scrim" @click="confirming = false" />
        <div class="modal" role="dialog" aria-modal="true">
          <h3>{{ t('review.cancelTitle') }}</h3>
          <p class="tiny muted">{{ t('review.cancelNote') }}</p>
          <div class="row">
            <button class="btn btn--danger" :disabled="busy" @click="cancel">
              <span v-if="busy" class="spinner" />
              <AppIcon v-else name="trash" :size="14" />
              {{ t('review.cancel') }}
            </button>
            <button class="btn" type="button" @click="confirming = false">
              {{ t('common.keep') }}
            </button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.entry__check {
  margin-top: 0.2rem;
  flex: none;
}
.entry__check--empty {
  width: 1.15rem;
}
.entry__edit {
  margin-top: 0.6rem;
}
.edit__bad {
  color: var(--bad-ink);
}
.fails {
  margin: 0.4rem 0 0;
  padding-left: 1.1rem;
}
.summary__counts {
  margin-bottom: 0.6rem;
}
.cancel {
  margin-top: 1.25rem;
}
.shots-block {
  margin-top: 1.25rem;
}
.shots-block summary {
  cursor: pointer;
  padding: 0.4rem 0;
}
.shots-block__hint {
  margin: 0.2rem 0 0.6rem;
}
</style>
