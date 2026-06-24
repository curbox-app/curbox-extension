import { useCallback, useEffect, useState } from "react";
import { browser } from "#imports";
import type { SyncRequest, SyncResponse, SyncStatus } from "../../lib/sync/types";

async function send(req: SyncRequest): Promise<SyncResponse> {
  return (await browser.runtime.sendMessage(req)) as SyncResponse;
}

export function useSync() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await send({ type: "sync:status" });
    if (res.status) setStatus(res.status);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (req: SyncRequest): Promise<SyncResponse> => {
      setBusy(true);
      setError(null);
      try {
        const res = await send(req);
        if (res.status) setStatus(res.status);
        if (!res.ok) setError(res.error ?? "Something went wrong");
        return res;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { status, busy, error, refresh, run };
}
