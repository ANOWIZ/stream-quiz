import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, BlockList } from "node:net";
import { extname } from "node:path";
import { requireRule } from "./game.js";
import { panoramaFormats } from "./panorama-files.js";
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 && /^[23]/.test(address) && !blocked.check(address, "ipv6");
}
export function importUrl(raw: string) {
  const url = new URL(raw);
  try {
    decodeURIComponent(url.pathname);
  } catch {
    throw new Error("Некорректное кодирование ссылки на файл");
  }
  requireRule(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443"),
    "Нужна прямая HTTPS-ссылка без пароля и нестандартного порта",
  );
  requireRule(
    !url.hostname.endsWith(".local") && url.hostname !== "localhost",
    "Локальные адреса запрещены",
  );
  return url;
}
export async function downloadPanorama(raw: string, maxBytes: number) {
  const url = importUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await Promise.race([
    lookup(host, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error("Истекло время поиска сервера")),
        5000,
      );
      t.unref();
    }),
  ]);
  requireRule(
    addresses.length && addresses.every((a) => publicAddress(a.address)),
    "Ссылка должна вести на публичный сервер",
  );
  const pinned = addresses[0];
  return await new Promise<{ buffer: Buffer; mime: string }>(
    (resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          headers: {
            Accept: "image/jpeg,image/png,image/webp",
            "Accept-Encoding": "identity",
          },
          lookup: (_hostname, options, cb) => {
            if (options.all) cb(null, [pinned]);
            else cb(null, pinned.address, pinned.family);
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.destroy();
            reject(
              new Error(
                "Сервер должен вернуть файл напрямую (HTTP 200), без перенаправлений",
              ),
            );
            return;
          }
          const mime = String(res.headers["content-type"] ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          const extension = extname(
            decodeURIComponent(url.pathname),
          ).toLowerCase();
          if (
            !panoramaFormats[mime] ||
            (extension && !panoramaFormats[mime].includes(extension))
          ) {
            res.destroy();
            reject(
              new Error(
                "Ссылка должна возвращать JPG, PNG или WebP с правильным MIME",
              ),
            );
            return;
          }
          if (Number(res.headers["content-length"]) > maxBytes) {
            res.destroy();
            reject(new Error("Файл по ссылке превышает лимит размера"));
            return;
          }
          const parts: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy();
              reject(new Error("Файл по ссылке превышает лимит размера"));
            } else parts.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => resolve({ buffer: Buffer.concat(parts), mime }));
        },
      );
      const deadline = setTimeout(
        () =>
          req.destroy(new Error("Истекло время загрузки панорамы (20 секунд)")),
        20000,
      );
      req.on("close", () => clearTimeout(deadline));
      req.on("error", reject);
      req.end();
    },
  );
}
