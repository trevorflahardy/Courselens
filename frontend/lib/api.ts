/* Typed fetch wrapper for the backend API */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network error";
    throw new Error(`Network error while calling ${path}: ${message}`);
  }

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// --- Nodes ---

import type {
  CourseNode,
  CourseNodeSummary,
  NodeLink,
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

  getNodeLinks: (id: string) => request<NodeLink[]>(`/api/nodes/${id}/links`),

  listAllNodeLinks: () => request<NodeLink[]>("/api/nodes/all-links"),

  updateNode: (id: string, body: Partial<CourseNode>) =>
    request<CourseNode>(`/api/nodes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  createNodeLink: (sourceId: string, targetId: string, linkType: "file" | "assignment" | "page") =>
    request<{ source_id: string; target_id: string; link_type: string }>(`/api/nodes/${sourceId}/links`, {
      method: "POST",
      body: JSON.stringify({ target_id: targetId, link_type: linkType }),
    }),

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

  cancelAuditRun: (runId: string) =>
    request<AuditRun>(`/api/audit/runs/${runId}/cancel`, { method: "POST" }),

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
    return fetch(`${API_BASE}/api/ingest/zip`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) {
        throw new Error(`API ${r.status}: ${await r.text()}`);
      }
      return r.json();
    });
  },

  rebuildGraph: () =>
    request<{ edges: number; orphans: number }>("/api/ingest/rebuild-graph", { method: "POST" }),

  getIngestStatus: () =>
    request<{ status: string; stage?: string; nodes_processed?: number; last_run?: string }>("/api/ingest/status"),

  cleanupTestData: () =>
    request<{
      nodes_deleted: number;
      edges_deleted: number;
      links_deleted: number;
      findings_deleted: number;
      audit_runs_deleted: number;
      rubrics_deleted: number;
    }>("/api/ingest/cleanup-test-data", { method: "POST" }),
};
