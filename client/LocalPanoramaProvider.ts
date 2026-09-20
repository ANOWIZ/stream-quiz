import { mediaUrl } from "./surface.js";
import * as THREE from "three";
import {
  clampPanoramaView,
  panoramaCameraSchema,
  type LocalPanoramaSource,
  type PanoramaView,
} from "../shared/panorama.js";
import type {
  PanoramaProvider,
  PanoramaInstance,
} from "./panorama-provider.js";
export class LocalPanoramaProvider implements PanoramaProvider {
  readonly id = "local";
  async mount(
    container: HTMLElement,
    source: LocalPanoramaSource,
    options: {
      signal: AbortSignal;
      onViewChange?: (view: PanoramaView) => void;
      onError?: (message: string) => void;
    },
  ): Promise<PanoramaInstance> {
    const settings = panoramaCameraSchema.parse(source.camera);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(source.fileId))
      throw new Error("Неверный файл панорамы");
    const response = await fetch(mediaUrl(source.fileId), {
      cache: "no-store",
      signal: options.signal,
    });
    if (!response.ok)
      throw new Error(
        "Файл панорамы недоступен. Ведущий может отменить финал и выбрать другую панораму.",
      );
    const picture = await createImageBitmap(await response.blob());
    if (options.signal.aborted) {
      picture.close();
      throw new DOMException("Просмотр закрыт", "AbortError");
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      picture.close();
      throw new Error(
        "Браузер не смог включить WebGL. Откройте панораму в браузере с поддержкой аппаратного ускорения.",
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(
      picture.width,
      renderer.capabilities.maxTextureSize,
      4096,
    );
    canvas.height = canvas.width / 2;
    canvas
      .getContext("2d")!
      .drawImage(picture, 0, 0, canvas.width, canvas.height);
    picture.close();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(90, 1, 0.1, 1000);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.SphereGeometry(100, 64, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    scene.add(new THREE.Mesh(geometry, material));
    let view = clampPanoramaView(settings, settings),
      destroyed = false;
    const render = () => {
      if (destroyed) return;
      camera.fov = 90 / view.zoom;
      camera.aspect =
        Math.max(1, container.clientWidth) /
        Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      const phi = THREE.MathUtils.degToRad(90 - view.pitch),
        theta = THREE.MathUtils.degToRad(view.heading);
      camera.lookAt(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );
      renderer.setSize(
        Math.max(1, container.clientWidth),
        Math.max(1, container.clientHeight),
      );
      renderer.render(scene, camera);
      container.dataset.heading = String(view.heading);
      container.dataset.pitch = String(view.pitch);
      container.dataset.zoom = String(view.zoom);
      options.onViewChange?.({ ...view });
    };
    const update = (values: Partial<PanoramaView>) => {
      view = clampPanoramaView({ ...view, ...values }, settings);
      render();
    };
    const pointers = new Map<number, { x: number; y: number }>();
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      container.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const previous = pointers.get(e.pointerId);
      if (!previous) return;
      const oldDistance = distance();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const d = distance();
        if (oldDistance > 0) update({ zoom: (view.zoom * d) / oldDistance });
      } else if (pointers.size === 1)
        update({
          heading: view.heading - (e.clientX - previous.x) * 0.2,
          pitch: view.pitch + (e.clientY - previous.y) * 0.2,
        });
    };
    const up = (e: PointerEvent) => pointers.delete(e.pointerId);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      update({ zoom: view.zoom * Math.exp(-e.deltaY * 0.0015) });
    };
    const key = (e: KeyboardEvent) => {
      if (
        ![
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "+",
          "-",
          "=",
        ].includes(e.key)
      )
        return;
      e.preventDefault();
      if (e.key === "ArrowLeft") update({ heading: view.heading - 8 });
      if (e.key === "ArrowRight") update({ heading: view.heading + 8 });
      if (e.key === "ArrowUp") update({ pitch: view.pitch + 5 });
      if (e.key === "ArrowDown") update({ pitch: view.pitch - 5 });
      if (e.key === "+" || e.key === "=") update({ zoom: view.zoom * 1.2 });
      if (e.key === "-") update({ zoom: view.zoom / 1.2 });
    };
    const zoomBar = document.createElement("div");
    zoomBar.className = "local-zoom";
    for (const [label, factor] of [
      ["+", 1.2],
      ["−", 1 / 1.2],
    ] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.ariaLabel = factor > 1 ? "Приблизить панораму" : "Отдалить панораму";
      b.onclick = () => update({ zoom: view.zoom * factor });
      zoomBar.appendChild(b);
    }
    container.appendChild(zoomBar);
    container.addEventListener("pointerdown", down);
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerup", up);
    container.addEventListener("pointercancel", up);
    container.addEventListener("wheel", wheel, { passive: false });
    container.addEventListener("keydown", key);
    const lost = (e: Event) => {
      e.preventDefault();
      options.onError?.(
        "Браузер потерял графический контекст. Повторите загрузку панорамы.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const resize = new ResizeObserver(render);
    resize.observe(container);
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      resize.disconnect();
      options.signal.removeEventListener("abort", destroy);
      container.removeEventListener("pointerdown", down);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerup", up);
      container.removeEventListener("pointercancel", up);
      container.removeEventListener("wheel", wheel);
      container.removeEventListener("keydown", key);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.dispose();
      renderer.forceContextLoss();
      texture.dispose();
      material.dispose();
      geometry.dispose();
      renderer.domElement.remove();
      zoomBar.remove();
      pointers.clear();
    };
    options.signal.addEventListener("abort", destroy, { once: true });
    if (options.signal.aborted) destroy();
    else render();
    return { getView: () => ({ ...view }), destroy };
  }
}
