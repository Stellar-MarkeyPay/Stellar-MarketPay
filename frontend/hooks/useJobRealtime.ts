import { useEffect, useRef, useState } from "react";
import type { Job, Application } from "@/utils/types";
import { fetchJob, fetchApplications } from "@/lib/api";

export function useJobRealtime(jobId: string | null, currentJob: Job | null, currentApplications: Application[]) {
  const [stagedJob, setStagedJob] = useState<Job | null>(null);
  const [stagedApplications, setStagedApplications] = useState<Application[] | null>(null);
  const [hasUpdates, setHasUpdates] = useState(false);
  
  const currentJobRef = useRef(currentJob);
  const currentAppsRef = useRef(currentApplications);
  
  useEffect(() => {
    currentJobRef.current = currentJob;
    currentAppsRef.current = currentApplications;
  }, [currentJob, currentApplications]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const backoff = useRef(1000);

  const isFirstFetch = useRef(true);

  const fetchLatest = async () => {
    if (!jobId) return;
    try {
      const [updatedJob, updatedApps] = await Promise.all([
        fetchJob(jobId),
        fetchApplications(jobId)
      ]);
      setStagedJob(updatedJob);
      setStagedApplications(updatedApps);
      
      if (!isFirstFetch.current) {
        // Compare with current
        const jobChanged = updatedJob.updatedAt !== currentJobRef.current?.updatedAt;
        const appsChanged = updatedApps.length !== currentAppsRef.current.length || 
          updatedApps.some((app, i) => app.id !== currentAppsRef.current[i]?.id);
          
        if (jobChanged || appsChanged) {
          setHasUpdates(true);
        }
      }
      isFirstFetch.current = false;
    } catch (err) {
      console.error("Failed to fetch updates:", err);
    }
  };

  const connect = () => {
    if (!jobId || typeof window === "undefined") return;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ||
      (window.location.protocol === "https:" ? "wss:" : "ws:") +
      "//" +
      (process.env.NEXT_PUBLIC_API_URL || window.location.host).replace(/^https?:\/\//, "") +
      "/ws/realtime";

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Job realtime WS connected");
      backoff.current = 1000;
      // Resynchronise on connect
      fetchLatest();
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        const { event, payload } = data;

        if (
          event === `job:${jobId}:bids` ||
          event === `job:${jobId}:updated` ||
          event === "job:status-changed" ||
          event === "contract:event"
        ) {
          // Only process events for this job
          if (
            payload?.jobId === jobId || 
            event.startsWith(`job:${jobId}`)
          ) {
            fetchLatest();
          }
        }
      } catch (err) {
        console.error("WS message parse error:", err);
      }
    };

    ws.onclose = () => {
      console.log("Job realtime WS closed");
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = setTimeout(() => {
        backoff.current = Math.min(backoff.current * 1.5, 30000);
        connect();
      }, backoff.current);
    };
  };

  useEffect(() => {
    connect();
    
    // Fallback polling (every 30s) if WS is not working/connected
    const pollInterval = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        fetchLatest();
      }
    }, 30000);

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      clearInterval(pollInterval);
    };
  }, [jobId]);

  return {
    stagedJob,
    stagedApplications,
    hasUpdates,
    applyUpdates: () => setHasUpdates(false),
  };
}
