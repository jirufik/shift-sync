export type ThemeMode = 'system' | 'light' | 'dark'
export type Palette = 'tokyo' | 'catppuccin' | 'nord' | 'graphite'

/** Ключ подписи берётся из словаря: гаммы называются на языке интерфейса. */
export const PALETTES: Array<{ key: Palette; label: string }> = [
  { key: 'tokyo', label: 'palette.tokyo' },
  { key: 'catppuccin', label: 'palette.catppuccin' },
  { key: 'nord', label: 'palette.nord' },
  { key: 'graphite', label: 'palette.graphite' },
]

const THEME_KEY = 'fc:theme'
const PALETTE_KEY = 'fc:palette'
const MODES: ThemeMode[] = ['system', 'light', 'dark']

/**
 * Тема и палитра.
 *
 * Тема — светлая, тёмная или системная; палитра — какой набор цветов при этом
 * взят. Оси независимы: у каждой гаммы нарисованы обе стороны, и переключение
 * света не меняет выбранную гамму (D-021). Три состояния темы, а не два: «как
 * в системе» — разумное значение по умолчанию, и терять его ради упрощения
 * переключателя не стоит.
 *
 * Выбор хранится в localStorage и применяется атрибутами `data-theme` и
 * `data-palette`; до гидратации это делает встроенный скрипт из nuxt.config,
 * иначе страница успела бы моргнуть светлой при тёмной системе.
 */
export function useTheme() {
  const mode = useState<ThemeMode>('fc:theme', () => 'system')
  const palette = useState<Palette>('fc:palette', () => 'tokyo')

  /** Запись в хранилище отдельно: в приватном режиме она может быть запрещена. */
  function remember(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      // приватный режим или запрет на хранение — выбор просто не переживёт перезагрузку
    }
  }

  function setTheme(next: ThemeMode): void {
    mode.value = next
    if (!import.meta.client) return
    const root = document.documentElement
    if (next === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', next)
    remember(THEME_KEY, next === 'system' ? null : next)
  }

  function setPalette(next: Palette): void {
    palette.value = next
    if (!import.meta.client) return
    const root = document.documentElement
    // палитра по умолчанию живёт на голом :root — атрибут для неё не нужен
    if (next === 'tokyo') root.removeAttribute('data-palette')
    else root.setAttribute('data-palette', next)
    remember(PALETTE_KEY, next === 'tokyo' ? null : next)
  }

  /** Читает сохранённый выбор. Зовётся один раз при монтировании приложения. */
  function restore(): void {
    if (!import.meta.client) return
    let savedTheme: string | null = null
    let savedPalette: string | null = null
    try {
      savedTheme = localStorage.getItem(THEME_KEY)
      savedPalette = localStorage.getItem(PALETTE_KEY)
    } catch {
      savedTheme = null
    }
    setTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system')
    setPalette(
      PALETTES.some((item) => item.key === savedPalette) ? (savedPalette as Palette) : 'tokyo',
    )
  }

  function cycleTheme(): void {
    setTheme(MODES[(MODES.indexOf(mode.value) + 1) % MODES.length]!)
  }

  return { mode, palette, setTheme, setPalette, cycleTheme, restore }
}
