import { create } from "zustand";

interface CameraState {
  /** Camera centre in world units. */
  x: number;
  y: number;
  /** Zoom scale (pixels per world unit). */
  zoom: number;
  setPosition: (x: number, y: number) => void;
  pan: (dx: number, dy: number) => void;
  setZoom: (zoom: number) => void;
  zoomBy: (factor: number) => void;
}

export const MIN_ZOOM = 8;
export const MAX_ZOOM = 34;

export const useCameraStore = create<CameraState>((set) => ({
  x: 0,
  y: 0,
  zoom: 16,
  setPosition: (x, y) => set({ x, y }),
  pan: (dx, dy) => set((state) => ({ x: state.x + dx, y: state.y + dy })),
  setZoom: (zoom) =>
    set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }),
  zoomBy: (factor) =>
    set((state) => ({
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor)),
    })),
}));
