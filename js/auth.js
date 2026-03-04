// ============================================================
// SHARED AUTH HELPERS  (loaded on every page)
// ============================================================
const AUTH_KEY = 'home_auth_token';

function getToken()   { return localStorage.getItem(AUTH_KEY) || null; }
function setToken(t)  { localStorage.setItem(AUTH_KEY, t); }
function clearToken() { localStorage.removeItem(AUTH_KEY); }

function getUser() {
  const t = getToken();
  if (!t) return null;
  try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; }
}

function isLoggedIn() { return !!getUser(); }

function authHeaders() {
  const t = getToken();
  return t ? { 'Authorization': `Bearer ${t}` } : {};
}
