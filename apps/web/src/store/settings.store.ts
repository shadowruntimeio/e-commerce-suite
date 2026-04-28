import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import i18n from '../lib/i18n'

interface SettingsState {
  isDark: boolean
  lang: 'en' | 'zh'
  toggleDark: () => void
  setLang: (lang: 'en' | 'zh') => void
}

function applyTheme(isDark: boolean) {
  if (isDark) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      isDark: false,
      lang: 'zh',
      toggleDark: () => {
        const next = !get().isDark
        applyTheme(next)
        set({ isDark: next })
      },
      setLang: (lang) => {
        i18n.changeLanguage(lang)
        localStorage.setItem('ems-lang', lang)
        set({ lang })
      },
    }),
    {
      name: 'ems-settings',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.isDark)
      },
    }
  )
)
