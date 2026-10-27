// Centralized API configuration and fetch utility for StudyFlow.ai

/**
 * Base API URL configuration.
 * Order of precedence:
 * 1. Explicit Vite environment variable: import.meta.env.VITE_API_URL
 * 2. Production fallback: https://studyflow-api-jx1.onrender.com
 * 3. Development fallback: "" (uses relative /api routes handled by Vite proxy)
 */
const rawBaseUrl =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "https://studyflow-api-jx1.onrender.com" : "");

export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, "");

/**
 * Returns the fully qualified API URL for a given endpoint.
 * Ensures consistent leading slash handling.
 *
 * @param {string} endpoint - e.g. "/api/ai" or "api/study-planner/generate"
 * @returns {string} - e.g. "https://studyflow-api-jx1.onrender.com/api/ai" or "/api/ai"
 */
export function getApiUrl(endpoint) {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (!API_BASE_URL) {
    return cleanEndpoint;
  }
  return `${API_BASE_URL}${cleanEndpoint}`;
}

/**
 * Performs a fetch request to the configured API endpoint.
 * In development mode, if a relative endpoint encounters a network error
 * (e.g., dev proxy not running on expected port), it falls back to direct localhost:3001.
 * In production mode, it requests the deployed backend URL directly.
 *
 * @param {string} endpoint - e.g. "/api/ai"
 * @param {RequestInit} [options={}] - fetch options (method, headers, body, etc.)
 * @returns {Promise<Response>}
 */
export async function apiFetch(endpoint, options = {}) {
  const primaryUrl = getApiUrl(endpoint);

  try {
    return await fetch(primaryUrl, options);
  } catch (err) {
    // In local development, if proxy or primary relative URL failed with a network error,
    // attempt direct connection to localhost:3001
    const isDev = import.meta.env.DEV;
    if (isDev && (!API_BASE_URL || API_BASE_URL.includes("localhost"))) {
      const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
      const fallbackUrl = `http://localhost:3001${cleanEndpoint}`;
      if (primaryUrl !== fallbackUrl) {
        return await fetch(fallbackUrl, options);
      }
    }
    throw err;
  }
}

/**
 * Produces a clear, contextual error message for network/API failures.
 *
 * @param {Error|any} err
 * @returns {string}
 */
export function getApiErrorMessage(err) {
  const isNetworkError =
    err instanceof TypeError && err.message?.toLowerCase().includes("fetch");

  if (isNetworkError) {
    if (import.meta.env.PROD) {
      return "Unable to connect to the StudyFlow AI backend server. If the server is waking up on Render, please wait a moment and try again.";
    }
    return "Unable to connect to the backend server. Please verify http://localhost:3001 is active.";
  }

  return err?.message || "The AI request failed. Please try again.";
}
