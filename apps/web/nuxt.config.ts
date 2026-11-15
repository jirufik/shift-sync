export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',

  // D-011: SPA, раздаётся самим NestJS; SSR тут не даёт ничего
  ssr: false,

  devServer: { port: 4081 },

  // в разработке фронт живёт отдельно, поэтому /api проксируется на backend
  nitro: {
    devProxy: {
      '/api': { target: 'http://127.0.0.1:4080/api', changeOrigin: true },
    },
  },

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: 'Shift Sync',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'color-scheme', content: 'light dark' },
      ],
      script: [
        {
          // Язык, тема и гамма выставляются до первой отрисовки. Без этого
          // страница успевает моргнуть светлой у тех, кто выбрал тёмную, —
          // заметно и неприятно; язык нужен здесь же, потому что от него
          // зависит, как браузер рисует и произносит содержимое.
          innerHTML:
            "try{var r=document.documentElement," +
            "t=localStorage.getItem('fc:theme'),p=localStorage.getItem('fc:palette')," +
            "l=localStorage.getItem('fc:locale');" +
            "if(t==='light'||t==='dark')r.setAttribute('data-theme',t);" +
            "if(p&&/^[a-z]+$/.test(p))r.setAttribute('data-palette',p);" +
            "r.setAttribute('lang',l==='ru'||l==='en'?l:" +
            "((navigator.language||'').indexOf('ru')===0?'ru':'en'))}catch(e){}",
          type: 'text/javascript',
          tagPosition: 'head',
        },
      ],
    },
  },

  typescript: { typeCheck: false, strict: true },
})
