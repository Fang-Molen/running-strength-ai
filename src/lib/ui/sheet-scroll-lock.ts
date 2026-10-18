type ScrollBody = { style: { overflow: string } };
const locks = new WeakMap<ScrollBody, { count: number; previous: string }>();
/** Nested atlas -> detail/draft sheets release scrolling only after the last one closes. */
export function lockSheetScroll(body: ScrollBody) {
  const state = locks.get(body) ?? { count: 0, previous: body.style.overflow };
  state.count++; locks.set(body, state); body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return false;
    released = true; state.count--;
    if (state.count > 0) return false;
    body.style.overflow = state.previous; locks.delete(body); return true;
  };
}
