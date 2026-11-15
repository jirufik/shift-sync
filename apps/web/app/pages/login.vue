<script setup lang="ts">
import type { Message } from '@fc/contracts'

const { login } = useAuth()
const router = useRouter()
const { t, message } = useI18n()

const password = ref('')
const error = ref<Message | string | null>(null)
const busy = ref(false)

async function submit() {
  error.value = null
  busy.value = true
  try {
    await login(password.value)
    await router.push('/')
  } catch (e) {
    error.value = apiError(e)
    password.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <h1>{{ t('app.name') }}</h1>
    <p class="lede">{{ t('login.lede') }}</p>

    <form class="card" @submit.prevent="submit">
      <div v-if="error" class="alert alert--bad">{{ message(error) }}</div>

      <label class="field">
        <span>{{ t('login.password') }}</span>
        <input v-model="password" type="password" autocomplete="current-password" autofocus>
      </label>

      <button type="submit" class="btn btn--primary btn--wide" :disabled="busy || !password">
        <span v-if="busy" class="spinner" />
        {{ t('login.submit') }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login {
  max-width: 22rem;
  margin: 15vh auto 0;
}
/* последнее поле в карточке не отодвигает кнопку лишним отступом */
.login .field {
  margin-bottom: 0.9rem;
}
</style>
