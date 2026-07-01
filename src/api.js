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
export const getUsers = () => call("GET", "/api/users");
export const login = (username, password) => call("POST", "/api/login", { username, password });
export const changePassword = (newPassword) => call("POST", "/api/change-password", { newPassword });
export const logout = () => call("POST", "/api/logout");
export const getState = () => call("GET", "/api/state");
export const putState = (state) => call("PUT", "/api/state", { state });
export const getActivity = () => call("GET", "/api/activity");
// logboek-actie; faalt stil zodat het de app nooit ophoudt
export const logAction = (action) => call("POST", "/api/log", { action }).catch(() => {});
