---
title: Version and Minimize localStorage Data
impact: MEDIUM
impactDescription: prevents schema conflicts, reduces storage size
tags: client, localStorage, storage, versioning, data-minimization
---

## Version and Minimize localStorage Data

Add version prefix to keys and store only needed fields. Prevents schema conflicts and accidental storage of sensitive data.

**Incorrect:**

```typescript
// No version, stores everything, no error handling
localStorage.setItem('userConfig', JSON.stringify(fullUserObject))
const data = localStorage.getItem('userConfig')
```

**Correct:**

```typescript
const VERSION = 'v2'

function saveConfig(config: { theme: string; language: string }): boolean {
  try {
    localStorage.setItem(`userConfig:${VERSION}`, JSON.stringify(config))
    return true
  } catch {
    return false
  }
}

function loadConfig() {
  try {
    const data = localStorage.getItem(`userConfig:${VERSION}`)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

// Migration from v1 to v2
function migrate() {
  try {
    const v1 = localStorage.getItem('userConfig:v1')
    if (v1) {
      const old = JSON.parse(v1)
      const saved = saveConfig({ theme: old.darkMode ? 'dark' : 'light', language: old.lang })
      if (saved) {
        localStorage.removeItem('userConfig:v1')
      }
    }
  } catch {}
}
```

Remove the old key only after the new value is stored successfully. A failed write must leave the original data available for retry or recovery; callers must handle the `false` result rather than reporting a successful save.

**Store minimal fields from server responses:**

```typescript
// User object has 20+ fields, only store what UI needs
function cachePrefs(user: FullUser) {
  try {
    localStorage.setItem('prefs:v1', JSON.stringify({
      theme: user.preferences.theme,
      notifications: user.preferences.notifications
    }))
  } catch {}
}
```

**Handle storage failures:** Access can throw when storage is blocked or unavailable, and writes can exceed quota. Private browsing behavior varies by browser and configuration; it does not universally throw. Keep read/write failure paths without assuming why access failed.

**Benefits:** Schema evolution via versioning, reduced storage size, prevents storing tokens/PII/internal flags.
