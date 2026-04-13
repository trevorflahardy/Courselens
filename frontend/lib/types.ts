/* TypeScript types mirroring backend Pydantic models */

// --- Enums ---

export type NodeType = "assignment" | "page" | "rubric" | "lecture" | "announcement" | "file";
export type NodeStatus = "ok" | "warn" | "gap" | "orphan" | "unaudited";
export type FindingSeverity = "gap" | "warn" | "info" | "ok";
export type FindingStatus = "active" | "stale" | "resolved" | "superseded" | "confirmed";
export type EdgeType = "explicit" | "inferred" | "artifact" | "gap";
export type EdgeStatus = "active" | "stale";
export type AuditStatus = "running" | "done" | "error" | "paused";

export type FindingType =
  | "clarity"
  | "rubric_mismatch"
  | "rubric_drift"
  | "assumption_gap"
  | "implicit_prerequisite"
  | "dependency_gap"
  | "format_mismatch"
  | "orphan"
  | "cascade_risk"
  | "curriculum_gap"
  | "broken_file_link";

// --- Rubric Models ---

export interface RubricRating {
  id: string;
  label: string;
  points: number;
  description: string | null;
}

export interface RubricCriterion {
  id: string;
  description: string;
  points: number;
  ratings: RubricRating[];
}

export interface Rubric {
  id: string;
  canvas_id: string | null;
  title: string;
  points_possible: number | null;
  criteria: RubricCriterion[];
  assignment_id: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

// --- Node Models ---

export interface CourseNode {
  id: string;
  type: NodeType;
  title: string;
  week: number | null;
  module: string | null;
  module_order: number | null;
  description: string | null;
  points_possible: number | null;
  submission_types: string[] | null;
  rubric_id: string | null;
  file_content: string | null;
  file_path: string | null;
  canvas_url: string | null;
  source: string;
  status: NodeStatus;
  content_hash: string | null;
  last_audited: string | null;
  finding_count: number;
  created_at: string;
  updated_at: string;
}

export interface CourseNodeSummary {
  id: string;
  type: NodeType;
  title: string;
  week: number | null;
  module: string | null;
  rubric_id: string | null;
  status: NodeStatus;
  finding_count: number;
}

export interface NodeLink {
  source_id: string;
  target_id: string;
  link_type: string;
}

// --- Finding Models ---

export interface Finding {
  id: string;
  assignment_id: string;
  audit_run_id: string;
  severity: FindingSeverity;
  finding_type: FindingType;
  title: string;
  body: string;
  linked_node: string | null;
  evidence: string | null;
  pass_number: number;
  status: FindingStatus;
  content_hash_at_creation: string | null;
  superseded_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

// --- Suggestion Models ---

export type SuggestionStatus =
  | "pending"
  | "approved"
  | "denied"
  | "ignored"
  | "done_manually";

export type SuggestionTargetType =
  | "description"
  | "page_body"
  | "rubric_criterion"
  | "module_item"
  | "title";

export interface Suggestion {
  id: string;
  finding_id: string;
  node_id: string;
  field: string;
  target_type: SuggestionTargetType;
  target_ref: string | null;
  original_text: string;
  suggested_text: string;
  diff_patch: string;
  status: SuggestionStatus;
  denial_reason: string | null;
  ignore_reason: string | null;
  manual_note: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

// --- Changelog / Applied Changes ---

export type AppliedChangeAction = "applied" | "denied" | "ignored" | "done_manually";

export interface AppliedChange {
  id: string;
  suggestion_id: string | null;
  finding_id: string;
  node_id: string;
  action: AppliedChangeAction;
  target_type: string;
  field: string;
  original_text: string;
  new_text: string;
  diff_patch: string;
  finding_title: string;
  finding_severity: FindingSeverity;
  finding_pass: number | null;
  evidence_quote: string | null;
  reason_or_note: string | null;
  canvas_response: string | null;
  handled_by: string;
  created_at: string;
}

export interface AssignmentNote {
  id: string;
  node_id: string;
  note: string;
  created_by: string;
  created_at: string;
}

export interface ChangelogStats {
  applied: number;
  denied: number;
  ignored: number;
  done_manually: number;
  total: number;
}

// --- Graph Models ---

export interface GraphEdge {
  source: string;
  target: string;
  edge_type: EdgeType;
  label: string | null;
  evidence: string | null;
  confidence: number | null;
  status: EdgeStatus;
  derived_at: string;
}

export interface GraphState {
  nodes: CourseNodeSummary[];
  edges: GraphEdge[];
  flags: CourseNodeSummary[];
}

export interface NodeGraphNeighbors {
  upstream: GraphEdge[];
  downstream: GraphEdge[];
}

// --- Audit Models ---

export interface AuditRun {
  id: string;
  assignment_id: string;
  status: AuditStatus;
  pass1_findings: number;
  pass2_findings: number;
  pass3_findings: number;
  total_findings: number;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  completed_passes: number;
  paused_at: string | null;
  resume_reason: string | null;
}

export interface AuditRuntimeState {
  batch_active: boolean;
  running_count: number;
  running_assignment_ids: string[];
}

// --- SSE Event Types ---

export type SSEEventType =
  | "finding"
  | "pass_start"
  | "pass_done"
  | "heartbeat"
  | "done"
  | "error"
  | "thinking";

export interface ThinkingPayload {
  text: string;
  pass: number;
}

export interface SSEEvent {
  type: SSEEventType;
  data: Finding | { pass: number } | { message: string } | ThinkingPayload | null;
}

// --- Dashboard Stats ---

export interface DashboardStats {
  total_nodes: number;
  gap_count: number;
  warn_count: number;
  ok_count: number;
  unaudited_count: number;
  total_findings: number;
  total_edges: number;
}
