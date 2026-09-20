import type { LocalPanoramaSource, PanoramaView } from "../shared/panorama.js";
export interface PanoramaInstance {
  getView(): PanoramaView;
  destroy(): void;
}
export interface PanoramaProvider<Source = LocalPanoramaSource> {
  readonly id: string;
  mount(
    container: HTMLElement,
    source: Source,
    options: {
      signal: AbortSignal;
      onViewChange?: (view: PanoramaView) => void;
      onError?: (message: string) => void;
    },
  ): Promise<PanoramaInstance>;
}
