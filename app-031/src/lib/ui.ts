import { reactive } from 'vue'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'good' | 'bad'
}

const toasts = reactive<Toast[]>([])
let seq = 1

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 2600): void {
  const id = seq++
  toasts.push({ id, text, kind })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, ms)
}

export function useToasts(): { toasts: typeof toasts } {
  return { toasts }
}
