// What every live figure on the site shares: three.js loaded once, each model parsed once, and the life of a stage
// (a canvas that is given a WebGL context when it comes near the screen, drawn only while it is on screen, and
// lets the context go again when the page has moved far away from it).

type Libs = [
  typeof import('three'),
  typeof import('three/examples/jsm/loaders/GLTFLoader.js'),
  typeof import('three/examples/jsm/environments/RoomEnvironment.js'),
];
let ready: Promise<Libs> | undefined;
export const libs = () =>
  (ready ??= Promise.all([
    import('three'),
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/environments/RoomEnvironment.js'),
  ]));

const models = new Map<string, Promise<any>>();
/** A glTF file, fetched and parsed once however many stages ask for it. Clone its scene; never pose it directly. */
export const loadModel = async (url: string) => {
  if (!models.has(url)) {
    const [, { GLTFLoader }] = await libs();
    models.set(url, new GLTFLoader().loadAsync(url));
  }
  return models.get(url)!;
};

export const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const ease = (u: number) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type Live = {
  /** One step of the figure and its drawing. `dt` is in seconds and never more than a twentieth. */
  frame: (dt: number) => void;
  resize?: () => void;
  dispose?: () => void;
};

/**
 * Runs a live figure inside `host`. `build` is given a fresh canvas (already in the page, as the host's first
 * child) and returns the figure. The figure is built when the host comes within a screen of the viewport, stepped
 * only while it is on screen and the tab is visible, and torn down (its WebGL context released) once the page is
 * several screens away, so a long page never holds more contexts than a phone allows.
 * If it cannot be built the host gets `is-failed` and whatever it shows without a canvas stays.
 */
export function liveStage(host: HTMLElement, build: (canvas: HTMLCanvasElement) => Promise<Live>) {
  let canvas: HTMLCanvasElement | null = null;
  let live: Live | null = null;
  let building = false, failed = false, near = false, visible = false, running = false, last = 0;

  const loop = (now: number) => {
    if (!live || !visible || document.hidden) { running = false; return; }
    // Never step backward: a frame's timestamp can be slightly earlier than the clock read that started the loop.
    live.frame(clamp((now - last) / 1000, 0, 0.05));
    last = now;
    requestAnimationFrame(loop);
  };
  const wake = () => {
    if (running || !live || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  };

  const mount = async () => {
    if (live || building || failed) return;
    building = true;
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    host.prepend(c);
    try {
      const built = await build(c);
      if (!near) { built.dispose?.(); c.remove(); return; } // the page left while it was loading
      canvas = c;
      live = built;
      live.resize?.();
      live.frame(0);
      host.classList.add('is-live');
      wake();
    } catch (err) {
      console.warn('Live figure unavailable:', err);
      c.remove();
      failed = true;
      host.classList.add('is-failed');
    } finally {
      building = false;
    }
  };
  const unmount = () => {
    if (!live) return;
    live.dispose?.();
    live = null;
    canvas?.remove();
    canvas = null;
    host.classList.remove('is-live');
  };

  new IntersectionObserver(([e]) => {
    near = e.isIntersecting;
    if (near) mount();
  }, { rootMargin: '900px 0px' }).observe(host);
  new IntersectionObserver(([e]) => { if (!e.isIntersecting) unmount(); }, { rootMargin: '3200px 0px' }).observe(host);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; wake(); }, { rootMargin: '60px 0px' }).observe(host);
  new ResizeObserver(() => { if (live) { live.resize?.(); live.frame(0); } }).observe(host);
  document.addEventListener('visibilitychange', wake);
}
