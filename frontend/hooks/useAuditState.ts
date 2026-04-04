"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AuditRuntimeState } from "@/lib/types";

const POLL_INTERVAL_MS = 2500;

const DEFAULT_STATE: AuditRuntimeState = {
  batch_active: false,
  running_count: 0,
  running_assignment_ids: [],
};

/**
 * Polls /api/audit/state every 2.5s while audits are running.
 * Automatically stops polling when nothing is active, restarts on next mount.
 */
export function useAuditState(): AuditRuntimeState {
  const [state, setState] = useState<AuditRuntimeState>(DEFAULT_STATE);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const data = await api.getAuditState();
      setState(data);
      if (data.running_count === 0 && !data.batch_active) {
        stopPolling();
      }
    } catch {
      // silently ignore polling errors — don't spam the user
    }
  }, [stopPolling]);

  useEffect(() => {
    // Always do an initial fetch on mount
    void poll();

    // Start interval — poll() will self-terminate when nothing is running
    intervalRef.current = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return stopPolling;
  }, [poll, stopPolling]);

  return state;
}
