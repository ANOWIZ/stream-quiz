export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (
      !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        u.hostname,
      )
    )
      return null;
    const id =
      u.hostname === "youtu.be"
        ? u.pathname.slice(1)
        : (u.searchParams.get("v") ?? u.pathname.split("/").pop());
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
