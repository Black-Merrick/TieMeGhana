// Single place where the API base URL is resolved, so no component ever
// hardcodes a host. In the containerized stack nginx proxies /api to the
// backend, which is why the default is a relative path rather than localhost.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

/**
 * Perform a JSON request against the API.
 *
 * Throws on a non 2xx response so callers handle failure explicitly rather
 * than silently rendering an error body as if it were data, which under
 * hospital connectivity is a realistic and easily missed failure mode.
 */
export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API request to ${path} failed with ${response.status}`);
  }

  return response.json();
}

/** Check that the API and its database are both reachable. */
export function fetchHealth() {
  return apiRequest("/health/");
}
