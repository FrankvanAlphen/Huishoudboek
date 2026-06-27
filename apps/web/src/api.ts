/** Dunne API-client. Cookies worden meegestuurd voor de sessie. */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Fout ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<{ authenticated: boolean }>("/auth/me"),
  login: (password: string) =>
    request<{ ok: true }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
};
