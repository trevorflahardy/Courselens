"use client";

import { useCallback, useRef, useState } from "react";
import type { Finding, SSEEvent, SSEEventType, ThinkingPayload } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type StreamStatus = "idle" | "connecting" | "streaming" | "done" | "error";

export interface UseAuditStreamReturn {
  events: SSEEvent[];
  findings: Finding[];
  currentPass: number;
  status: StreamStatus;
  error: string | null;
  thinkingText: string;
  thinkingPass: number;
  connect: (runId: string) => void;
  disconnect: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2000;

export function useAuditStream(): UseAuditStreamReturn {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [currentPass, setCurrentPass] = useState<number>(0);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [thinkingText, setThinkingText] = useState<string>("");
  const [thinkingPass, setThinkingPass] = useState<number>(0);

  const esRef = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRunId = useRef<string | null>(null);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    activeRunId.current = null;
  }, []);

  const connect = useCallback(
    (runId: string) => {
      // Clean up any previous connection
      disconnect();

      activeRunId.current = runId;
      reconnectAttempts.current = 0;
      setError(null);
      setStatus("connecting");
      setThinkingText("");
      setThinkingPass(0);

      function openConnection() {
        const url = `${API_BASE}/api/audit/${runId}/stream`;
        const es = new EventSource(url);
        esRef.current = es;

        function pushEvent(type: SSEEventType, data: SSEEvent["data"]) {
          const evt: SSEEvent = { type, data };
          setEvents((prev) => [...prev, evt]);
        }

        es.addEventListener("heartbeat", (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as { message: string };
            if (data.message === "connected") {
              setStatus("streaming");
              reconnectAttempts.current = 0;
            }
            pushEvent("heartbeat", data);
          } catch {
            // ignore malformed heartbeats
          }
        });

        es.addEventListener("pass_start", (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as { pass: number };
            setCurrentPass(data.pass);
            pushEvent("pass_start", data);
          } catch {
            // ignore
          }
        });

        es.addEventListener("pass_done", (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as { pass: number };
            pushEvent("pass_done", data);
          } catch {
            // ignore
          }
        });

        es.addEventListener("finding", (e: MessageEvent) => {
          try {
            const finding = JSON.parse(e.data) as Finding;
            setFindings((prev) => [...prev, finding]);
            pushEvent("finding", finding);
          } catch {
            // ignore
          }
        });

        es.addEventListener("thinking", (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as ThinkingPayload;
            setThinkingText((prev) => prev + data.text);
            setThinkingPass(data.pass);
            pushEvent("thinking", data);
          } catch {
            // ignore
          }
        });

        es.addEventListener("done", (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as { message: string };
            pushEvent("done", data);
          } catch {
            // ignore
          }
          setStatus("done");
          es.close();
          esRef.current = null;
        });

        es.addEventListener("error", (e: MessageEvent) => {
          // SSE "error" event type from the server (not browser-level)
          if (e.data) {
            try {
              const data = JSON.parse(e.data) as { message: string };
              setError(data.message);
              pushEvent("error", data);
              setStatus("error");
              es.close();
              esRef.current = null;
              return;
            } catch {
              // fall through to browser-level error handling
            }
          }
        });

        // Browser-level connection error (network drop, etc.)
        es.onerror = () => {
          es.close();
          esRef.current = null;

          if (
            activeRunId.current === runId &&
            reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS
          ) {
            reconnectAttempts.current += 1;
            setStatus("connecting");
            reconnectTimer.current = setTimeout(openConnection, RECONNECT_DELAY_MS);
          } else if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
            setError("Connection lost after multiple retries");
            setStatus("error");
          }
        };
      }

      openConnection();
    },
    [disconnect],
  );

  return {
    events,
    findings,
    currentPass,
    status,
    error,
    thinkingText,
    thinkingPass,
    connect,
    disconnect,
  };
}
