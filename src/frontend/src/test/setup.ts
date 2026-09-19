import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom does not implement canvas rendering. The game renders through a 2D
// context, so every canvas consumer needs a stub context to draw into.
function stubContext(): CanvasRenderingContext2D {
  const noop = (): void => undefined;
  const gradient = { addColorStop: noop };
  return {
    canvas: undefined as unknown as HTMLCanvasElement,
    save: noop,
    restore: noop,
    scale: noop,
    rotate: noop,
    translate: noop,
    transform: noop,
    setTransform: noop,
    resetTransform: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 0 }) as TextMetrics,
    drawImage: noop,
    createLinearGradient: () => gradient as unknown as CanvasGradient,
    createRadialGradient: () => gradient as unknown as CanvasGradient,
    createPattern: () => null,
    getImageData: () =>
      ({ data: new Uint8ClampedArray(4) }) as unknown as ImageData,
    putImageData: noop,
    setLineDash: noop,
    getLineDash: () => [],
  } as unknown as CanvasRenderingContext2D;
}

HTMLCanvasElement.prototype.getContext = vi.fn(function (
  this: HTMLCanvasElement,
  contextId: string,
) {
  if (contextId === "2d") {
    const ctx = stubContext();
    (ctx as { canvas: HTMLCanvasElement }).canvas = this;
    return ctx;
  }
  return null;
}) as unknown as HTMLCanvasElement["getContext"];

// jsdom has no layout engine, so clientWidth/clientHeight are always zero.
// The renderer divides by viewport dimensions, so give canvases a size.
Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return 800;
  },
});
Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return 600;
  },
});

// jsdom does not implement PointerEvent, so Testing Library's pointer helpers
// fall back to a plain Event and silently drop `button`, `clientX`, and
// `shiftKey`. The canvas input handlers read all three, so without this every
// pointer-driven selection or order is a no-op. MouseEvent carries the same
// fields the handlers use.
if (!window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom does not implement pointer capture, which the canvas input handlers
// call on every pointerdown/up. Without these the handlers throw before they
// can select or issue an order.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {
    /* no-op: jsdom has no pointer capture */
  };
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {
    /* no-op: jsdom has no pointer capture */
  };
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}

// jsdom does not implement scrollIntoView, which Radix Select calls when it
// opens a menu to bring the selected item into view. Without it, opening any
// Select throws and the menu never renders.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {
    /* no-op: jsdom has no layout to scroll */
  };
}

// Radix Select measures its trigger and content with ResizeObserver, which
// jsdom does not provide. A no-op observer is enough for the menu to mount.
if (!window.ResizeObserver) {
  class ResizeObserverPolyfill {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  window.ResizeObserver =
    ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(
      () => cb(performance.now()),
      16,
    ) as unknown as number) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof window.cancelAnimationFrame;
}

afterEach(() => {
  cleanup();
});
