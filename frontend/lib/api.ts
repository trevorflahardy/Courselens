/* Typed fetch wrapper for the backend API */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// --- Nodes ---

import type {
  CourseNode,
  CourseNodeSummary,
  Finding,
  GraphState,
  AuditRun,
  DashboardStats,
} from "./types";

export const api = {
  // Nodes
  listNodes: (params?: { type?: string; week?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set("type", params.type);
    if (params?.week) qs.set("week", String(params.week));
    if (params?.status) qs.set("status", params.status);
    const query = qs.toString();
    return request<CourseNodeSummary[]>(`/api/nodes${query ? `?${query}` : ""}`);
  },

  getNode: (id: string) => request<CourseNode>(`/api/nodes/${id}`),

  // Findings
  listFindings: (params?: { assignment_id?: string; severity?: string }) => {
    const qs = new URLSearchParams();
    if (params?.assignment_id) qs.set("assignment_id", params.assignment_id);
    if (params?.severity) qs.set("severity", params.severity);
    const query = qs.toString();
    return request<Finding[]>(`/api/findings${query ? `?${query}` : ""}`);
  },

  // Graph
  getGraph: () => request<GraphState>("/api/graph"),

  // Audit
  startAudit: (assignmentId: string) =>
    request<AuditRun>(`/api/audit/${assignmentId}`, { method: "POST" }),

  listAuditRuns: () => request<AuditRun[]>("/api/audit/runs"),

  getAuditRun: (runId: string) => request<AuditRun>(`/api/audit/runs/${runId}`),

  startAuditAll: (batchSize = 4) =>
    request<{ total: number; completed: number; errors: string[] }>(
      `/api/audit/all?batch_size=${batchSize}`,
      { method: "POST" },
    ),

  getAuditSummary: () =>
    request<Record<string, unknown>>("/api/audit/summary"),

  // Dashboard
  getStats: () => request<DashboardStats>("/api/stats"),

  // Ingest
  startIngest: () => request<{ status: string }>("/api/ingest/course", { method: "POST" }),

  uploadZip: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${API_BASE}/api/ingest/zip`, { method: "POST", body: form }).then(r => r.json());
  },

  rebuildGraph: () =>
    request<{ edges: number; orphans: number }>("/api/ingest/rebuild-graph", { method: "POST" }),

  getIngestStatus: () =>
    request<{ status: string; nodes_processed?: number; last_run?: string }>("/api/ingest/status"),
};
