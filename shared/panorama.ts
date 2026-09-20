import { z } from "zod";
export const defaultPanoramaCamera = {
  heading: 0,
  pitch: 0,
  zoom: 1,
  minZoom: 0.75,
  maxZoom: 4,
};
export const panoramaCameraSchema = z
  .object({
    heading: z.number().finite().min(-180).max(180),
    pitch: z.number().finite().min(-85).max(85),
    zoom: z.number().finite().min(0.6).max(6),
    minZoom: z.number().finite().min(0.6).max(6),
    maxZoom: z.number().finite().min(0.6).max(6),
  })
  .superRefine((c, ctx) => {
    if (c.minZoom > c.maxZoom || c.zoom < c.minZoom || c.zoom > c.maxZoom)
      ctx.addIssue({
        code: "custom",
        message:
          "Минимальный масштаб ≤ начальный масштаб ≤ максимальный масштаб",
      });
  });
export type PanoramaCamera = z.infer<typeof panoramaCameraSchema>;
export type PanoramaView = Pick<PanoramaCamera, "heading" | "pitch" | "zoom">;
export interface LocalPanoramaSource {
  provider: "local";
  fileId: string;
  camera: PanoramaCamera;
}
export function clampPanoramaView(
  view: PanoramaView,
  limits: Pick<PanoramaCamera, "minZoom" | "maxZoom">,
): PanoramaView {
  return {
    heading: ((((view.heading + 180) % 360) + 360) % 360) - 180,
    pitch: Math.max(-85, Math.min(85, view.pitch)),
    zoom: Math.max(limits.minZoom, Math.min(limits.maxZoom, view.zoom)),
  };
}
