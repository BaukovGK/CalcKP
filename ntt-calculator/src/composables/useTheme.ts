import { ref } from 'vue'

const STORAGE_KEY = 'ntt-theme'
const theme = ref<'dark' | 'light'>((localStorage.getItem(STORAGE_KEY) as 'dark' | 'light') ?? 'dark')

function applyTheme(t: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', t)
}

export function useTheme() {
  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, theme.value)
    applyTheme(theme.value)
  }
  return { theme, toggle }
}

// Apply immediately on import (before Vue mounts)
applyTheme(theme.value)
