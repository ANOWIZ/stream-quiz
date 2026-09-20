import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { RequestOptions, IncomingMessage } from "node:http";
import { downloadPanorama } from "../server/panorama-import.js";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
let status = 200,
  mime = "image/jpeg",
  body = Buffer.from("test-file"),
  seen: RequestOptions;
beforeEach(() => {
  status = 200;
  mime = "image/jpeg";
  body = Buffer.from("test-file");
  mocks.lookup
    .mockReset()
    .mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.request
    .mockReset()
    .mockImplementation(
      (
        _url: URL,
        options: RequestOptions,
        callback: (r: IncomingMessage) => void,
      ) => {
        seen = options;
        const req = new EventEmitter() as EventEmitter & {
          end: () => void;
          destroy: (error?: Error) => void;
        };
        req.destroy = (error) => {
          if (error) req.emit("error", error);
          req.emit("close");
        };
        req.end = () =>
          queueMicrotask(() => {
            const res = Object.assign(new PassThrough(), {
              statusCode: status,
              headers: {
                "content-type": mime,
                "content-length": String(body.length),
              },
            });
            callback(res as unknown as IncomingMessage);
            res.end(body);
            queueMicrotask(() => req.emit("close"));
          });
        return req;
      },
    );
});
it("импорт получает прямой файл и закрепляет проверенный DNS адрес", async () => {
  const result = await downloadPanorama("https://photos.example/pano.jpg", 100);
  expect(result).toEqual({ buffer: body, mime: "image/jpeg" });
  const callback = vi.fn();
  seen.lookup!("photos.example", { all: true }, callback);
  expect(callback).toHaveBeenCalledWith(null, [
    { address: "8.8.8.8", family: 4 },
  ]);
});
it("импорт не следует redirect, ограничивает размер и MIME", async () => {
  status = 302;
  await expect(
    downloadPanorama("https://photos.example/pano.jpg", 100),
  ).rejects.toThrow("без перенаправлений");
  status = 200;
  mime = "text/html";
  await expect(
    downloadPanorama("https://photos.example/pano.jpg", 100),
  ).rejects.toThrow("MIME");
  mime = "image/jpeg";
  await expect(
    downloadPanorama("https://photos.example/pano.jpg", 2),
  ).rejects.toThrow("лимит");
});
it("внутренний DNS и malformed URI отклоняются до HTTP запроса", async () => {
  mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  await expect(
    downloadPanorama("https://photos.example/pano.jpg", 100),
  ).rejects.toThrow("публичный");
  await expect(
    downloadPanorama("https://photos.example/%ZZ.jpg", 100),
  ).rejects.toThrow("кодирование");
  expect(mocks.request).not.toHaveBeenCalled();
});
