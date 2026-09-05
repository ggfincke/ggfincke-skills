---
title: Use Transitions for Non-Urgent Async Results
impact: LOW
impactDescription: keeps input responsive when result rendering is expensive
tags: rendering, transitions, useTransition, loading, state
---

## Use Transitions for Non-Urgent Async Results

Use transitions when rendering an update may interrupt urgent interaction. Manual loading state and the project's existing data layer are valid choices; `useTransition` is not a universal replacement.

**React 19+ example: urgent input, explicit request ordering, transitioned results.** The injected `fetchResults` is the application's existing search function.

```tsx
import { useEffect, useRef, useState, useTransition } from 'react'

type SearchResult = { id: string; title: string }

export function SearchResults({ fetchResults }: {
  fetchResults: (query: string) => Promise<SearchResult[]>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const latestRequest = useRef(0)

  useEffect(() => () => { latestRequest.current += 1 }, [])

  function handleSearch(value: string) {
    setQuery(value)
    const requestId = ++latestRequest.current

    startTransition(async () => {
      try {
        const data = await fetchResults(value)
        if (requestId !== latestRequest.current) return
        startTransition(() => {
          setResults(data)
          setError(null)
        })
      } catch {
        if (requestId !== latestRequest.current) return
        startTransition(() => setError('Search failed. Please retry.'))
      }
    })
  }

  return (
    <>
      <input aria-label="Search" value={query}
        onChange={event => handleSearch(event.target.value)} />
      {isPending && <p role="status">Updating results...</p>}
      {error && <p role="alert">{error}</p>}
      <ul>{results.map(result => <li key={result.id}>{result.title}</li>)}</ul>
    </>
  )
}
```

The request identity prevents an older response from replacing a newer query and invalidates outstanding results on unmount. It does not cancel network work; use the data layer's cancellation or an `AbortController` when appropriate. React can interrupt rendering, not automatically order or cancel arbitrary requests.

Current React requires another `startTransition` around state updates after `await`. Keep controlled input state outside it. `isPending` can remain true while any overlapping Action is unsettled, including an ignored old request; it is not a precise latest-request loading flag. On React 18, keep request loading/error ownership outside the transition and transition only the synchronous result update.

Reference: [React useTransition](https://react.dev/reference/react/useTransition).
