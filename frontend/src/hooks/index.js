/**
 * hooks/index.js
 * Hooks utilitarios reutilizables.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Retrasa la actualización de un valor hasta que el usuario deja de escribir.
 * Útil para búsquedas en tiempo real.
 */
export function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/**
 * Persiste un estado en localStorage automáticamente.
 */
export function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue
    } catch {
      return defaultValue
    }
  })

  const setStored = useCallback((val) => {
    setValue(val)
    try {
      localStorage.setItem(key, JSON.stringify(val))
    } catch {
      // El modo privado o una cuota llena no deben romper el estado en memoria.
    }
  }, [key])

  return [value, setStored]
}

/**
 * Detecta clics fuera de un elemento.
 * Útil para cerrar dropdowns.
 */
export function useClickOutside(callback) {
  const ref = useRef(null)
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) callback()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [callback])
  return ref
}

/**
 * Paginación simple para listas.
 */
export function usePagination(items, perPage = 20) {
  const [page, setPage] = useState(1)
  const totalPages = Math.ceil(items.length / perPage)
  const paginated = items.slice((page - 1) * perPage, page * perPage)

  return {
    page,
    setPage,
    totalPages,
    paginated,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  }
}
