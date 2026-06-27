// Kleine fetch-helpers naar de eigen server (zelfde origin).
async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(await res.text().catch(() => "fout"));
  return res.json();
}

export const me = () => call("GET", "/api/me");
export const login = (password) => call("POST", "/api/login", { password });
export const logout = () => call("POST", "/api/logout");
export const getState = () => call("GET", "/api/state");
export const putState = (state) => call("PUT", "/api/state", { state });
