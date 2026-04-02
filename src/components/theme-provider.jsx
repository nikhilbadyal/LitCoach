// Theme provider for dark mode support
// Automatically detects system preference and allows manual toggle

import { createContext, useContext, useEffect, useState } from "react"

const ThemeProviderContext = createContext({
  theme: "system",
  setTheme: () => null,
})

export function ThemeProvider({ children, defaultTheme = "system", storageKey = "ui-theme", ...props }) {
  const [theme, setTheme] = useState(() => {
    // Try to load theme from chrome storage
    return defaultTheme
  })

  useEffect(() => {
    // Load theme from chrome storage on mount
    chrome.storage.sync.get([storageKey], (result) => {
      if (result[storageKey]) {
        setTheme(result[storageKey])
      }
    })
  }, [storageKey])

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  // Compute the actually-applied theme so consumers (e.g. SyntaxHighlighter)
  // can branch on "light" vs "dark" without re-checking the OS preference.
  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme

  const value = {
    theme,
    // The concrete theme that is currently applied to the document root
    resolvedTheme,
    setTheme: (newTheme) => {
      // Save to chrome storage
      chrome.storage.sync.set({ [storageKey]: newTheme })
      setTheme(newTheme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
