import { useEffect, useRef } from 'react';

const REVEALED = 'is-revealed';
const READY = 'reveal-ready';

/**
 * Reveals `[data-reveal]` descendants of the returned ref as they scroll into
 * view, adding `.is-revealed` once each. Stagger comes from a `--reveal-i`
 * custom property on the element (see styles/Motion.css).
 *
 * The container only gets `.reveal-ready` after the observer is attached, so
 * content never depends on JS to be visible. Pass the values that rebuild the
 * children (a filter, a tab, a selection) as `deps` so new nodes are observed.
 */
export default function useScrollReveal(deps = []) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;

    const targets = Array.from(root.querySelectorAll('[data-reveal]'));
    if (!targets.length) return undefined;

    const prefersReducedMotion =
      typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') {
      targets.forEach((element) => element.classList.add(REVEALED));
      return undefined;
    }

    root.classList.add(READY);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add(REVEALED);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.08 },
    );

    const pending = targets.filter((element) => !element.classList.contains(REVEALED));
    pending.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      // Leave already-revealed nodes alone; the next mount observes the rest.
      if (!pending.length) root.classList.remove(READY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
