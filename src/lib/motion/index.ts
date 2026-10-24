import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** One small motion module: reveal observer, smooth scroll, parallax, count-up. CSS holds the visuals. */

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const REVEAL = '.rv, .words';

function reveal(el: Element) {
  el.classList.add('in');
  el.querySelectorAll('.words').forEach((n) => n.classList.add('in'));
}

/** Start once at app boot. Returns a cleanup. */
export function initMotion(): () => void {
  if (typeof document === 'undefined') return () => {};
  const root = document.documentElement;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) root.dataset.solid = '';
  if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') {
    root.classList.add('motion-off');
    return () => {};
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        reveal(e.target);
        io.unobserve(e.target);
      }
    },
    { threshold: 0.18, rootMargin: '0px 0px -6% 0px' },
  );
  const watch = (el: Element) => {
    if (!el.classList.contains('in')) io.observe(el);
  };
  const scan = (n: ParentNode) => n.querySelectorAll(REVEAL).forEach(watch);
  scan(document);
  const mo = new MutationObserver((muts) => {
    for (const m of muts)
      m.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.matches(REVEAL)) watch(n);
        scan(n);
      });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Gentle parallax on the background blobs only (never on text).
  let blobs: { el: HTMLElement; k: number }[] = [];
  const onScroll = () => {
    const y = window.scrollY;
    if (!blobs.length)
      blobs = [...document.querySelectorAll<HTMLElement>('[data-par]')].map((el) => ({
        el,
        k: Number(el.dataset.par),
      }));
    for (const b of blobs) b.el.style.transform = `translate3d(0,${y * b.k}px,0)`;
  };
  addEventListener('scroll', onScroll, { passive: true });

  let raf = 0;
  let cancelled = false;
  let destroy: (() => void) | null = null;
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => number })
    .requestIdleCallback;
  const boot = () => {
    if (cancelled || location.pathname.startsWith('/doc/')) return;
    void import('lenis').then(({ default: Lenis }) => {
      if (cancelled) return;
      const l = new Lenis({
        duration: 1.15,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
      });
      destroy = () => l.destroy();
      const loop = (t: number) => {
        l.raf(t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
  };
  if (idle) idle(boot);
  else setTimeout(boot, 800);

  return () => {
    cancelled = true;
    io.disconnect();
    mo.disconnect();
    removeEventListener('scroll', onScroll);
    cancelAnimationFrame(raf);
    destroy?.();
  };
}

const easeOutQuart = (p: number) => 1 - Math.pow(1 - p, 4);

/** Counts from 0 to `value` once; the final value always equals `value` exactly. */
export function useCountUp(value: number, ms = 1500): number {
  const [shown, setShown] = useState(value);
  const done = useRef(false);
  useLayoutEffect(() => {
    if (done.current || prefersReducedMotion()) {
      setShown(value);
      return;
    }
    done.current = true;
    let frame = 0;
    let t0: number | null = null;
    setShown(0);
    let finished = false;
    const step = (t: number) => {
      t0 ??= t;
      const p = Math.min((t - t0) / ms, 1);
      setShown(p < 1 ? Math.round(value * easeOutQuart(p)) : value);
      if (p < 1) frame = requestAnimationFrame(step);
      else finished = true;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      if (!finished) done.current = false;
    };
  }, [value, ms]);
  return shown;
}

/** 0..1 progress of an element passing through the viewport, for the timeline rail. */
export function useScrollProgress(ref: RefObject<HTMLElement | null>): number {
  const [p, setP] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const calc = () => {
      const r = el.getBoundingClientRect();
      setP(Math.max(0, Math.min(1, (innerHeight * 0.75 - r.top) / r.height)));
    };
    calc();
    addEventListener('scroll', calc, { passive: true });
    addEventListener('resize', calc);
    return () => {
      removeEventListener('scroll', calc);
      removeEventListener('resize', calc);
    };
  }, [ref]);
  return p;
}
