// Interface routes share the existing host/player session roles.
export const isObs = location.pathname === "/obs";
export const isEditor = location.pathname === "/editor";
export function mediaUrl(id: string) {
  return (isObs ? "/api/obs-media/" : "/media/") + encodeURIComponent(id);
}
