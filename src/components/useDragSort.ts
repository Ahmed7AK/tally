import { useCallback, useRef, useState } from 'react'

/* ---------------------------------------------------------------------------
   Drag-to-reorder, built on Pointer Events.

   The HTML5 drag-and-drop API is not an option: `dragstart` never fires from a
   touch on iOS, so it would work on the Mac and silently do nothing on the
   phone. Pointer Events cover mouse, touch and pencil through one path.

   Dragging is started from a dedicated grip rather than the whole row, for two
   reasons: a row-wide drag competes with scrolling on touch, and it makes
   tapping a checkbox risky. The grip carries `touch-action: none` so the
   browser hands us the gesture instead of scrolling the page.

   While dragging, positions are moved with CSS transforms directly on the DOM
   nodes — going through React state for every pointermove would re-render the
   list dozens of times a second. React only hears about it once, on drop.
   --------------------------------------------------------------------------- */

export interface DragSortResult {
  /** Attach to the scrolling list element. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Index currently being dragged, or null. */
  draggingIndex: number | null
  /** Spread onto each grip handle. */
  gripProps: (index: number) => {
    onPointerDown: (e: React.PointerEvent) => void
    onKeyDown: (e: React.KeyboardEvent) => void
    role: string
    tabIndex: number
    'aria-label': string
    style: React.CSSProperties
  }
}

interface DragState {
  from: number
  to: number
  startY: number
  items: HTMLElement[]
  heights: number[]
  pointerId: number
  grip: HTMLElement
}

export function useDragSort(
  count: number,
  onReorder: (from: number, to: number) => void,
  label = 'Reorder',
): DragSortResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<DragState | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)

  const clearTransforms = useCallback((items: HTMLElement[]) => {
    for (const el of items) {
      el.style.transform = ''
      el.style.transition = ''
      el.style.zIndex = ''
      el.style.position = ''
      el.style.pointerEvents = ''
    }
  }, [])

  const onPointerDown = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      const container = containerRef.current
      if (!container || count < 2) return

      const items = Array.from(
        container.querySelectorAll<HTMLElement>('[data-sortable="true"]'),
      )
      if (items.length !== count) return

      const grip = e.currentTarget as HTMLElement
      grip.setPointerCapture(e.pointerId)
      e.preventDefault()

      drag.current = {
        from: index,
        to: index,
        startY: e.clientY,
        items,
        heights: items.map((el) => el.getBoundingClientRect().height),
        pointerId: e.pointerId,
        grip,
      }

      const dragged = items[index]
      dragged.style.zIndex = '5'
      dragged.style.position = 'relative'
      dragged.style.pointerEvents = 'none'
      setDraggingIndex(index)
    },
    [count],
  )

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return

    const dy = e.clientY - d.startY
    d.items[d.from].style.transform = `translateY(${dy}px)`

    // Walk outward from the origin, accumulating neighbour heights until the
    // pointer has travelled far enough to pass one.
    let to = d.from
    if (dy > 0) {
      let travelled = 0
      for (let i = d.from + 1; i < d.items.length; i++) {
        travelled += d.heights[i]
        if (dy > travelled - d.heights[i] / 2) to = i
        else break
      }
    } else if (dy < 0) {
      let travelled = 0
      for (let i = d.from - 1; i >= 0; i--) {
        travelled += d.heights[i]
        if (-dy > travelled - d.heights[i] / 2) to = i
        else break
      }
    }
    d.to = to

    // Shift the rows the dragged item has passed, to open a gap where it lands.
    const draggedHeight = d.heights[d.from]
    d.items.forEach((el, i) => {
      if (i === d.from) return
      let shift = 0
      if (to > d.from && i > d.from && i <= to) shift = -draggedHeight
      else if (to < d.from && i >= to && i < d.from) shift = draggedHeight
      el.style.transition = 'transform .16s ease'
      el.style.transform = shift ? `translateY(${shift}px)` : ''
    })
  }, [])

  const finish = useCallback(() => {
    const d = drag.current
    if (!d) return
    drag.current = null
    clearTransforms(d.items)
    setDraggingIndex(null)
    try {
      d.grip.releasePointerCapture(d.pointerId)
    } catch {
      // Capture may already be gone if the pointer was cancelled.
    }
    if (d.to !== d.from) onReorder(d.from, d.to)
  }, [clearTransforms, onReorder])

  // Listeners live on the grip via pointer capture, so they are registered
  // once here rather than per render.
  const gripProps = useCallback(
    (index: number) => ({
      onPointerDown: (e: React.PointerEvent) => {
        onPointerDown(index)(e)
        const move = (ev: PointerEvent) => onPointerMove(ev)
        const up = () => {
          finish()
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      },
      // Keyboard equivalent, so reordering is not mouse-only.
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowUp' && index > 0) {
          e.preventDefault()
          onReorder(index, index - 1)
        } else if (e.key === 'ArrowDown' && index < count - 1) {
          e.preventDefault()
          onReorder(index, index + 1)
        }
      },
      role: 'button',
      tabIndex: 0,
      'aria-label': `${label} — use arrow keys to move`,
      style: { touchAction: 'none' as const, cursor: 'grab' },
    }),
    [onPointerDown, onPointerMove, finish, onReorder, count, label],
  )

  return { containerRef, draggingIndex, gripProps }
}
