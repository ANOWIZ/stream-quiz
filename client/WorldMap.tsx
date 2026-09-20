import type { GeoPoint } from "../shared/content.js";
import { interiorPoint, containsPoint } from "../shared/geography.js";
import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { geoEqualEarth, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry, Feature } from "geojson";
import { Plus, Minus, RotateCcw, Maximize, Minimize, X } from "lucide-react";
import { Modal } from "./Modal.js";
type Props = { code: string; name: string };
type World = FeatureCollection<Geometry, Props>;
type Pick = { code: string; name: string; color: string; point?: GeoPoint };
let cached: World | null = null;
type MapView = { zoom: number; x: number; y: number };
type MapPoint = { x: number; y: number };
const initialView: MapView = { zoom: 1, x: 0, y: 0 };
const center = { x: 480, y: 250 };
function mapPoint(svg: SVGSVGElement, x: number, y: number): MapPoint {
  const matrix = svg.getScreenCTM();
  if (!matrix) return center;
  const point = new DOMPoint(x, y).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}
function zoomed(view: MapView, factor: number, anchor = center): MapView {
  const zoom = Math.max(1, Math.min(16, view.zoom * factor));
  const ratio = zoom / view.zoom;
  return {
    zoom,
    x: anchor.x - center.x - (anchor.x - center.x - view.x) * ratio,
    y: anchor.y - center.y - (anchor.y - center.y - view.y) * ratio,
  };
}
export function WorldMap({
  selected,
  selectedPoint,
  correctPoint,
  onSelect,
  picks = [],
  correct,
  disabled = false,
  fullscreenActions,
}: {
  selected?: string | null;
  onSelect?: (code: string, point: GeoPoint) => void;
  selectedPoint?: GeoPoint;
  correctPoint?: GeoPoint;
  picks?: Pick[];
  correct?: string;
  disabled?: boolean;
  fullscreenActions?: ReactNode;
}) {
  const [data, setData] = useState<World | null>(cached);
  const [filter, setFilter] = useState("");
  const [view, setView] = useState(initialView);
  const viewRef = useRef(view);
  const { zoom } = view;
  const [fullscreen, setFullscreen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const pointers = useRef(new Map<number, MapPoint & { start: MapPoint }>());
  const dragged = useRef(false);
  const changeView = useCallback((next: MapView) => {
    const bounded = {
      zoom: next.zoom,
      x: Math.max(
        -480 * (next.zoom - 1),
        Math.min(480 * (next.zoom - 1), next.x),
      ),
      y: Math.max(
        -250 * (next.zoom - 1),
        Math.min(250 * (next.zoom - 1), next.y),
      ),
    };
    viewRef.current = bounded;
    setView(bounded);
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 500 : 1);
      changeView(
        zoomed(
          viewRef.current,
          Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002),
          mapPoint(svg!, event.clientX, event.clientY),
        ),
      );
    };
    svg?.addEventListener("wheel", wheel, { passive: false });
    pointers.current.clear();
    if (!fullscreen && restoreFocus.current) {
      expandRef.current?.focus();
      restoreFocus.current = false;
    }
    return () => svg?.removeEventListener("wheel", wheel);
  }, [fullscreen, changeView]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!cached)
      void fetch("/world.json")
        .then((r) => r.json())
        .then((d: World) => {
          cached = d;
          setData(d);
        })
        .catch(() => setError("Не удалось открыть карту. Обновите страницу."));
  }, []);
  const group = useRef<SVGGElement>(null);
  const projection = useMemo(
    () =>
      geoEqualEarth().fitExtent(
        [
          [12, 12],
          [948, 486],
        ],
        { type: "Sphere" },
      ),
    [],
  );
  const path = useMemo(() => geoPath(projection), [projection]);
  const select = (f: Feature<Geometry, Props>, point?: GeoPoint) => {
    const chosen = point ?? interiorPoint(f);
    if (!disabled && chosen && containsPoint(f, chosen))
      onSelect?.(f.properties.code, chosen);
  };
  const pins = [
    ...picks,
    ...(selected && selectedPoint
      ? [
          {
            code: selected,
            point: selectedPoint,
            name: "Ваш выбор",
            color: "#a5a0fb",
          },
        ]
      : []),
    ...(correct
      ? [
          {
            code: correct,
            point: correctPoint,
            name: "✓ Место съёмки",
            color: "#e3fc83",
          },
        ]
      : []),
  ];
  const content = (
    <div className={"world-map" + (fullscreen ? " map-fullscreen" : "")}>
      {fullscreen && (
        <header className="map-fullscreen-header">
          <h2>{disabled ? "Карта стран" : "Выбор страны"}</h2>
          <button
            aria-label="Закрыть полноэкранную карту"
            onClick={() => setFullscreen(false)}
          >
            <X size={23} />
          </button>
        </header>
      )}
      <div className="map-tools">
        {!disabled ? (
          <label className="map-search">
            Найти страну
            <input
              placeholder="Название страны"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
        ) : (
          <span className="muted">Страны, которые выбрали игроки</span>
        )}
      </div>
      {filter && (
        <div className="country-search-results">
          {data?.features
            .filter((f) =>
              f.properties.name
                .toLocaleLowerCase("ru")
                .includes(filter.toLocaleLowerCase("ru")),
            )
            .slice(0, 12)
            .map((f) => (
              <button
                disabled={disabled}
                key={f.properties.code}
                onClick={() => {
                  select(f);
                  setFilter("");
                }}
              >
                {f.properties.name}
              </button>
            ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="map-viewport">
        <svg
          ref={svgRef}
          viewBox="0 0 960 500"
          role="group"
          aria-label="Карта стран мира"
          tabIndex={0}
          data-zoom={zoom}
          className={"map-svg" + (disabled ? "" : " is-selectable")}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            const current = viewRef.current;
            if (
              [
                "+",
                "=",
                "-",
                "Home",
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
              ].includes(e.key)
            )
              e.preventDefault();
            if (e.key === "+" || e.key === "=")
              changeView(zoomed(current, 1.5));
            if (e.key === "-") changeView(zoomed(current, 1 / 1.5));
            if (e.key === "Home") changeView(initialView);
            if (e.key === "ArrowLeft")
              changeView({ ...current, x: current.x + 60 });
            if (e.key === "ArrowRight")
              changeView({ ...current, x: current.x - 60 });
            if (e.key === "ArrowUp")
              changeView({ ...current, y: current.y + 60 });
            if (e.key === "ArrowDown")
              changeView({ ...current, y: current.y - 60 });
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const point = mapPoint(e.currentTarget, e.clientX, e.clientY);
            if (!pointers.current.size) dragged.current = false;
            pointers.current.set(e.pointerId, { ...point, start: point });
            if (pointers.current.size > 1) {
              dragged.current = true;
              for (const id of pointers.current.keys())
                e.currentTarget.setPointerCapture(id);
            }
          }}
          onPointerMove={(e) => {
            const previous = pointers.current.get(e.pointerId);
            if (!previous) return;
            const point = mapPoint(e.currentTarget, e.clientX, e.clientY);
            const other = [...pointers.current.entries()].find(
              ([id]) => id !== e.pointerId,
            )?.[1];
            if (other) {
              const distance = Math.hypot(
                previous.x - other.x,
                previous.y - other.y,
              );
              const midpoint = {
                x: (previous.x + other.x) / 2,
                y: (previous.y + other.y) / 2,
              };
              const next = zoomed(
                viewRef.current,
                distance > 0
                  ? Math.hypot(point.x - other.x, point.y - other.y) / distance
                  : 1,
                midpoint,
              );
              changeView({
                ...next,
                x: next.x + (point.x - previous.x) / 2,
                y: next.y + (point.y - previous.y) / 2,
              });
            } else if (
              dragged.current ||
              Math.hypot(
                point.x - previous.start.x,
                point.y - previous.start.y,
              ) > 5
            ) {
              const origin = dragged.current ? previous : previous.start;
              dragged.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              changeView({
                ...viewRef.current,
                x: viewRef.current.x + point.x - origin.x,
                y: viewRef.current.y + point.y - origin.y,
              });
            }
            pointers.current.set(e.pointerId, {
              ...point,
              start: previous.start,
            });
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId);
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            dragged.current = true;
          }}
          onPointerLeave={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId))
              pointers.current.delete(e.pointerId);
          }}
        >
          <rect width="960" height="500" fill="#141d27" />
          <g
            ref={group}
            transform={
              "translate(" +
              view.x +
              " " +
              view.y +
              ") translate(480 250) scale(" +
              zoom +
              ") translate(-480 -250)"
            }
          >
            {data?.features.map((f) => {
              const code = f.properties.code;
              const pick = picks.find((p) => p.code === code);
              return (
                <path
                  key={code}
                  data-country={code}
                  d={path(f) ?? ""}
                  fill={
                    code === correct
                      ? "#e3fc83"
                      : code === selected
                        ? "#a5a0fb"
                        : (pick?.color ?? "#35424d")
                  }
                  stroke="#141d27"
                  strokeWidth={0.7 / zoom}
                  role={disabled ? undefined : "button"}
                  tabIndex={disabled ? undefined : 0}
                  aria-label={f.properties.name}
                  aria-pressed={disabled ? undefined : code === selected}
                  onClick={
                    disabled
                      ? undefined
                      : (e) => {
                          if (dragged.current && e.detail !== 0) return;
                          const matrix = group.current?.getScreenCTM();
                          if (!matrix) return;
                          const pixel = new DOMPoint(
                            e.clientX,
                            e.clientY,
                          ).matrixTransform(matrix.inverse());
                          const coordinate = projection.invert?.([
                            pixel.x,
                            pixel.y,
                          ]);
                          if (coordinate)
                            select(f, {
                              longitude: coordinate[0],
                              latitude: coordinate[1],
                            });
                        }
                  }
                  onKeyDown={
                    disabled
                      ? undefined
                      : (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            select(f);
                          }
                        }
                  }
                >
                  <title>{f.properties.name}</title>
                </path>
              );
            })}
            {pins.map((pin, index) => {
              const country = data?.features.find(
                (f) => f.properties.code === pin.code,
              );
              const point =
                pin.point ?? (country ? interiorPoint(country) : null);
              if (!point) return null;
              const xy = projection([point.longitude, point.latitude]);
              if (!xy) return null;
              const [x, y] = xy;
              return (
                <g
                  key={index}
                  data-pin={pin.name}
                  data-longitude={point.longitude}
                  data-latitude={point.latitude}
                  transform={
                    "translate(" + x + " " + y + ") scale(" + 1 / zoom + ")"
                  }
                  pointerEvents="none"
                >
                  <circle
                    r={pin.code === correct && pin.name.startsWith("✓") ? 7 : 5}
                    fill={pin.color}
                    stroke="#101216"
                    strokeWidth="2"
                  />
                  <g transform={"translate(9 " + (index * 19 - 8) + ")"}>
                    <rect
                      x="-2"
                      y="-12"
                      rx="3"
                      width={Math.max(75, pin.name.length * 8)}
                      height="20"
                      fill="#101216"
                    />
                    <text fill={pin.color} fontSize="13" fontWeight="bold">
                      {pin.name}
                    </text>
                  </g>
                  <title>
                    {pin.name + ": " + (country?.properties.name ?? pin.code)}
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
        <div
          className="map-controls"
          role="group"
          aria-label="Управление картой"
        >
          <button
            aria-label="Увеличить карту"
            title="Увеличить карту"
            disabled={zoom >= 16}
            onClick={() => changeView(zoomed(viewRef.current, 1.5))}
          >
            <Plus size={20} />
          </button>
          <button
            aria-label="Уменьшить карту"
            title="Уменьшить карту"
            disabled={zoom <= 1}
            onClick={() => changeView(zoomed(viewRef.current, 1 / 1.5))}
          >
            <Minus size={20} />
          </button>
          <button
            aria-label="Сбросить масштаб"
            title="Сбросить масштаб"
            onClick={() => changeView(initialView)}
          >
            <RotateCcw size={19} />
          </button>
          <button
            ref={expandRef}
            aria-label={
              fullscreen ? "Свернуть карту" : "Открыть карту на весь экран"
            }
            title={
              fullscreen ? "Свернуть карту" : "Открыть карту на весь экран"
            }
            aria-expanded={fullscreen}
            onClick={() => {
              restoreFocus.current = true;
              setFullscreen(!fullscreen);
            }}
          >
            {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
      </div>
      <p className="map-hint">
        {disabled
          ? "Салатовый — правильная страна. Имена и цвета — ответы игроков."
          : selected
            ? "Выбрано: " +
              (data?.features.find((f) => f.properties.code === selected)
                ?.properties.name ?? selected)
            : "Нажмите на территорию страны. Карту можно увеличить и перемещать."}
      </p>
      {fullscreen && fullscreenActions}
    </div>
  );
  return fullscreen ? (
    <Modal
      label="Карта на весь экран"
      className="map-fullscreen-overlay"
      onClose={() => setFullscreen(false)}
    >
      {content}
    </Modal>
  ) : (
    content
  );
}
