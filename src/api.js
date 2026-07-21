// Kleine fetch-helpers naar de eigen server (zelfde origin).
async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (res.status === 409) { const body = await res.json().catch(() => ({})); const err = new Error("conflict"); err.conflict = true; err.current = body.current; throw err; }
  if (!res.ok) throw new Error(await res.text().catch(() => "fout"));
  return res.json();
}

export const me = () => call("GET", "/api/me");
export const getUsers = () => call("GET", "/api/users");
export const login = (username, password) => call("POST", "/api/login", { username, password });
export const changePassword = (newPassword, currentPassword) => call("POST", "/api/change-password", { newPassword, currentPassword });
export const logout = () => call("POST", "/api/logout");
export const listHouseholds = () => call("GET", "/api/admin/households");
export const createHousehold = (key, name) => call("POST", "/api/admin/households", { key, name });
export const createAccount = (household, username, displayName) => call("POST", "/api/admin/accounts", { household, username, displayName });
export const deleteAccount = (username) => call("DELETE", "/api/admin/accounts/" + encodeURIComponent(username));
export const getState = () => call("GET", "/api/state");
export const putState = (state, rev) => call("PUT", "/api/state", { state, rev });
export const getSnapshots = () => call("GET", "/api/snapshots");
export const getSnapshot = (id) => call("GET", "/api/snapshots/" + id);
// Bijlagen (bonnetjes/facturen) — losse opslag naast de financiële state.
export const uploadAttachment = (payload) => call("POST", "/api/attachments", payload);
export const listAttachments = (txId) => call("GET", "/api/attachments/tx/" + encodeURIComponent(txId));
export const deleteAttachment = (id) => call("DELETE", "/api/attachments/" + id);
export const attachmentCounts = () => call("GET", "/api/attachments/counts");
export const attachmentUrl = (id) => "/api/attachments/" + id;
export const getActivity = () => call("GET", "/api/activity");
// logboek-actie; faalt stil zodat het de app nooit ophoudt
export const logAction = (action) => call("POST", "/api/log", { action }).catch(() => {});
// debug: stuurt regels naar de server-terminal (Railway-logs). Faalt stil.
export const debugLog = (label, lines) => call("POST", "/api/debug-log", { label, lines }).catch(() => {});
