export type ApiResult<T> = {
  ok: boolean;
  status: number;
  d: T & { error?: string; message?: string; warning?: string };
};

export async function api<T = Record<string, unknown>>(
  url: string,
  method = "GET",
  body?: unknown,
  retry = true,
): Promise<ApiResult<T>> {
  const r = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Token akses hanya 15 menit; refresh_token httpOnly memperbaruinya otomatis.
  if (r.status === 401 && retry && !url.startsWith("/api/auth/")) {
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    if (refreshed.ok) return api<T>(url, method, body, false);
  }

  const data = (await r.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    warning?: string;
  };
  return { ok: r.ok, status: r.status, d: data };
}
