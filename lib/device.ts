/** Ringkas User-Agent menjadi label perangkat yang mudah dikenali pengguna. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "Perangkat tidak dikenal";

  const app = /expo|reactnative|react-native|okhttp|cfnetwork|finwise/i.test(ua) ? "Aplikasi HP" : null;
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /chrome\/|crios\//i.test(ua)
      ? "Chrome"
      : /firefox\/|fxios\//i.test(ua)
        ? "Firefox"
        : /safari\//i.test(ua)
          ? "Safari"
          : null;
  const os = /windows nt/i.test(ua)
    ? "Windows"
    : /android/i.test(ua)
      ? "Android"
      : /iphone|ipad|ipod/i.test(ua)
        ? "iOS"
        : /mac os x/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : null;

  const parts = [app ?? browser, os].filter(Boolean);
  return (parts.length ? parts.join(" di ") : ua).slice(0, 191);
}
