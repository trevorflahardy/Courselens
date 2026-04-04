"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { Suggestion, SuggestionStatus } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/*  Diff renderer                                                              */
/* -------------------------------------------------------------------------- */

function DiffView({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <pre className="rounded-lg bg-[oklch(0.10_0.01_280)] border border-[oklch(0.25_0.02_270_/_0.4)] text-[11px] leading-5 overflow-x-auto p-3 font-mono">
      {lines.map((line, i) => {
        const cls =
          line.startsWith("+") && !line.startsWith("+++")
            ? "text-emerald-400 bg-emerald-950/40 block"
            : line.startsWith("-") && !line.startsWith("---")
            ? "text-red-400 bg-red-950/40 block"
            : line.startsWith("@@")
            ? "text-sky-400 block"
            : "text-muted-foreground/60 block";
        return (
          <span key={i} className={cls}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

/* -------------------------------------------------------------------------- */
/*  Suggestion card                                                            */
/* -------------------------------------------------------------------------- */

function SuggestionCard({
  suggestion,
  onAction,
}: {
  suggestion: Suggestion;
  onAction: (id: string, action: "approve" | "deny" | "ignore") => Promise<void>;
}) {
  const [loading, setLoading] = useState<"approve" | "deny" | "ignore" | null>(null);

  const handle = async (action: "approve" | "deny" | "ignore") => {
    setLoading(action);
    try {
      await onAction(suggestion.id, action);
    } finally {
      setLoading(null);
    }
  };

  const statusColor: Record<SuggestionStatus, string> = {
    pending: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    approved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    denied: "bg-red-500/20 text-red-300 border-red-500/30",
    ignored: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  };

  return (
    <div className="glass-card rounded-xl glow-border p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-mono text-muted-foreground/50 shrink-0">{suggestion.node_id}</span>
          <span className="text-muted-foreground/30">·</span>
          <span className="text-[11px] text-muted-foreground/60 shrink-0">field: <span className="font-mono text-primary/70">{suggestion.field}</span></span>
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] shrink-0 border ${statusColor[suggestion.status]}`}
        >
          {suggestion.status}
        </Badge>
      </div>

      {/* Diff */}
      <DiffView patch={suggestion.diff_patch} />

      {/* Actions */}
      {suggestion.status === "pending" && (
        <div className="flex gap-2">
          <button
            onClick={() => handle("approve")}
            disabled={loading !== null}
            className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
          >
            {loading === "approve" ? "Applying…" : "Approve"}
          </button>
          <button
            onClick={() => handle("deny")}
            disabled={loading !== null}
            className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/20 transition-all disabled:opacity-50"
          >
            {loading === "deny" ? "Denying…" : "Deny"}
          </button>
          <button
            onClick={() => handle("ignore")}
            disabled={loading !== null}
            className="flex-1 rounded-lg border border-zinc-500/30 bg-zinc-500/10 px-3 py-1.5 text-[12px] font-medium text-zinc-400 hover:bg-zinc-500/20 transition-all disabled:opacity-50"
          >
            Ignore
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

type Filter = "pending" | "all";

export default function SuggestionsPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listSuggestions(
        filter === "pending" ? { status: "pending" } : undefined,
      );
      setSuggestions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = useCallback(
    async (id: string, action: "approve" | "deny" | "ignore") => {
      if (action === "approve") await api.approveSuggestion(id);
      else if (action === "deny") await api.denySuggestion(id);
      else await api.ignoreSuggestion(id);
      // Optimistic remove from pending view
      setSuggestions((prev) =>
        filter === "pending" ? prev.filter((s) => s.id !== id) : prev.map((s) => s.id === id ? { ...s, status: action === "approve" ? "approved" : action === "deny" ? "denied" : "ignored" } : s),
      );
    },
    [filter],
  );

  const pendingCount = suggestions.filter((s) => s.status === "pending").length;

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">AI Suggestions</h1>
          <p className="text-[13px] text-muted-foreground/60 mt-1">
            AI-generated text fixes for clarity and format findings. Approve to apply directly to Canvas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter("pending")}
            className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition-all ${filter === "pending" ? "border-primary/40 bg-primary/10 text-primary" : "border-[oklch(0.35_0.03_270_/_0.3)] text-muted-foreground/60 hover:text-foreground"}`}
          >
            Pending {filter === "pending" && pendingCount > 0 ? `(${pendingCount})` : ""}
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition-all ${filter === "all" ? "border-primary/40 bg-primary/10 text-primary" : "border-[oklch(0.35_0.03_270_/_0.3)] text-muted-foreground/60 hover:text-foreground"}`}
          >
            All
          </button>
          <button
            onClick={load}
            className="px-3 py-1 rounded-lg text-[12px] font-medium border border-[oklch(0.35_0.03_270_/_0.3)] text-muted-foreground/60 hover:text-foreground transition-all"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground/40 text-[13px]">
          Loading suggestions…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-[13px] text-red-400">
          {error}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2">
          <p className="text-muted-foreground/40 text-[13px]">
            {filter === "pending" ? "No pending suggestions — run an audit to generate some." : "No suggestions yet."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} onAction={handleAction} />
          ))}
        </div>
      )}
    </div>
  );
}
