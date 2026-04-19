export function saveToken(token: string) {
  localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
}

export function removeToken() {
  clearToken();
}

export function getToken() {
  return localStorage.getItem("token");
}

export function isLoggedIn() {
  return !!getToken();
}
