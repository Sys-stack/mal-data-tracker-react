const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;
  if (!res.ok) {
    const message = body?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

const get = (path) => request(path);
const post = (path, data) => request(path, { method: "POST", body: JSON.stringify(data ?? {}) });
const del = (path) => request(path, { method: "DELETE" });

export const api = {
  getConfig: () => get("/config"),

  // catalog
  listCatalog: (params = {}) => get(`/catalog?${new URLSearchParams(params)}`),
  getAnime: (id) => get(`/catalog/${id}`),
  getAnimeTeams: (id) => get(`/catalog/${id}/teams`),
  refreshCatalog: (season, year) => post("/catalog/refresh", { season, year }),
  addAnime: (id) => post("/catalog", { id }),
  setTracked: (id, tracked) => post(`/catalog/${id}/track`, { tracked }),

  // growth (Postgres)
  getGrowth: (id, params = {}) => get(`/anime/${id}/growth?${new URLSearchParams(params)}`),
  manualSync: () => post("/sync"),

  // predictions
  listPredictions: (id) => get(`/predictions/${id}`),
  fitPrediction: (id, metric, seed) => post(`/predictions/${id}/fit`, { metric, seed }),
  setPrediction: (id, metric, baseline, a, b) => post(`/predictions/${id}/set`, { metric, baseline, a, b }),

  // teams
  listTeams: () => get("/teams"),
  createTeam: (name) => post("/teams", { name }),
  deleteTeam: (id) => del(`/teams/${id}`),
  getRoster: (id) => get(`/teams/${id}/roster`),
  getAvailable: (id, params = {}) => get(`/teams/${id}/available?${new URLSearchParams(params)}`),
  draft: (teamId, animeId, slot) => post(`/teams/${teamId}/draft`, { anime_id: animeId, slot }),
  undraft: (teamId, animeId) => post(`/teams/${teamId}/undraft`, { anime_id: animeId }),
  compare: (teamId, metric) => get(`/teams/${teamId}/compare?metric=${metric}`),

  // planner
  listActions: (teamId) => get(`/teams/${teamId}/actions`),
  deleteAction: (teamId, actionId) => del(`/teams/${teamId}/actions/${actionId}`),
  resetActions: (teamId) => post(`/teams/${teamId}/actions/reset`),
  scheduleSwap: (teamId, week, benchToActive, activeToBench) =>
    post(`/teams/${teamId}/actions/swap`, { week, bench_to_active: benchToActive, active_to_bench: activeToBench }),
  scheduleAce: (teamId, week, animeId) => post(`/teams/${teamId}/actions/ace`, { week, anime_id: animeId }),
  scheduleWildcard: (teamId, week, type, targetTeam) =>
    post(`/teams/${teamId}/actions/wildcard`, { week, type, target_team: targetTeam }),
  simulate: (teamId) => get(`/teams/${teamId}/simulate`),
};
