import { mediaUrl } from "./surface.js";
import { useEffect, useRef, useState } from "react";
import type { MediaRef } from "../shared/content.js";
import type { VideoState } from "../shared/types.js";
import { youtubeId } from "../shared/media.js";
interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(t: number, a: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  mute(): void;
  unMute(): void;
  destroy(): void;
}
interface YouTubeOptions {
  host: string;
  videoId: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady: () => void;
    onAutoplayBlocked: () => void;
    onError: () => void;
  };
}
type YouTubeConstructor = new (
  element: HTMLElement,
  options: YouTubeOptions,
) => YouTubePlayer;
let youtube: Promise<YouTubeConstructor> | null = null;
async function loadYouTube() {
  const w = window as unknown as {
    YT?: { Player: YouTubeConstructor };
    onYouTubeIframeAPIReady?: () => void;
  };
  if (w.YT?.Player) return w.YT.Player;
  if (!youtube)
    youtube = new Promise<YouTubeConstructor>((resolve, reject) => {
      const previous = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (w.YT?.Player) resolve(w.YT.Player);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        youtube = null;
        reject(Error("Не удалось загрузить YouTube"));
      };
      document.head.appendChild(script);
    });
  return youtube;
}
export function Media({
  media,
  state,
  serverNow,
  receivedAt,
  preview = false,
}: {
  media: MediaRef;
  state?: VideoState;
  serverNow?: number;
  receivedAt?: number;
  preview?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const yt = useRef<YouTubePlayer | null>(null);
  const [ready, setReady] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const source = media.fileId ? mediaUrl(media.fileId) : media.url;
  const current = useRef({
    media,
    state,
    serverNow,
    receivedAt: receivedAt ?? Date.now(),
  });
  current.current = {
    media,
    state,
    serverNow,
    receivedAt: receivedAt ?? Date.now(),
  };
  const syncRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (media.kind !== "youtube" || !holder.current) return;
    let disposed = false;
    let player: YouTubePlayer | null = null;
    const id = youtubeId(media.url ?? "");
    if (!id) {
      setError("Неверная ссылка YouTube");
      return;
    }
    const container = holder.current;
    void loadYouTube()
      .then((Player) => {
        if (disposed) return;
        const child = document.createElement("div");
        container.appendChild(child);
        player = new Player(child, {
          host: "https://www.youtube-nocookie.com",
          videoId: id,
          playerVars: {
            controls: preview ? 1 : 0,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            origin: location.origin,
            start: Math.floor(media.start),
            ...(media.end ? { end: Math.floor(media.end) } : {}),
          },
          events: {
            onReady: () => {
              if (disposed) return;
              yt.current = player;
              setReady((r) => r + 1);
            },
            onAutoplayBlocked: () => setBlocked(true),
            onError: () =>
              setError(
                "Видео недоступно для встраивания. Проверьте ссылку и права доступа.",
              ),
          },
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      disposed = true;
      player?.destroy();
      yt.current = null;
      container.replaceChildren();
    };
  }, [media.kind, media.url, preview, media.start, media.end]);
  useEffect(() => {
    if (!state || media.kind === "image") return;
    const sync = () => {
      const {
        state: s,
        media: m,
        serverNow: clock,
        receivedAt: receipt,
      } = current.current;
      if (!s) return;
      const now = (clock ?? Date.now()) + Date.now() - receipt;
      const target = Math.min(
        m.end ?? Infinity,
        Math.max(
          m.start,
          s.offset + (s.status === "playing" ? (now - s.changedAt) / 1000 : 0),
        ),
      );
      const playing =
        s.status === "playing" && (m.end === undefined || target < m.end);
      const v = video.current;
      if (v && v.readyState > 0) {
        if (Math.abs(v.currentTime - target) > 0.8) v.currentTime = target;
        if (playing && v.paused) void v.play().catch(() => setBlocked(true));
        else if (!playing) v.pause();
      }
      const y = yt.current;
      if (y) {
        if (Math.abs(y.getCurrentTime() - target) > 0.8) y.seekTo(target, true);
        if (m.muted) y.mute();
        else y.unMute();
        if (playing && y.getPlayerState() !== 1) y.playVideo();
        else if (!playing) y.pauseVideo();
      }
      if (!playing) setBlocked(false);
    };
    syncRef.current = sync;
    sync();
    const timer = setInterval(sync, 1000);
    return () => clearInterval(timer);
  }, [state, media.kind, serverNow, receivedAt, ready]);
  if (media.kind === "image")
    return <img className="question-media" src={source} alt={media.alt} />;
  return (
    <div className="video-container">
      {media.kind === "youtube" ? (
        <div
          className="question-media video-media youtube-media"
          ref={holder}
          aria-label={media.alt}
        />
      ) : (
        <video
          className="question-media video-media"
          ref={video}
          src={source}
          controls={preview}
          muted={media.muted}
          playsInline
          aria-label={media.alt}
          onLoadedMetadata={() => {
            if (preview && video.current)
              video.current.currentTime = media.start;
            setReady((r) => r + 1);
          }}
          onTimeUpdate={() => {
            if (
              video.current &&
              media.end &&
              video.current.currentTime >= media.end
            )
              video.current.pause();
          }}
        />
      )}
      {error && <p className="error">{error}</p>}
      {blocked && state?.status === "playing" && (
        <button
          onClick={() => {
            setBlocked(false);
            syncRef.current();
          }}
        >
          Разрешить воспроизведение
        </button>
      )}
    </div>
  );
}
