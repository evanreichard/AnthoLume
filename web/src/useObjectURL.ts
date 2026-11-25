import { useEffect, useMemo, useState } from 'react';

type Source = { blob: Blob };

export function useObjectURL(blob: Blob | null | undefined): string | undefined {
  // Selection Identity - Switching back to a previous blob must not reuse its revoked URL.
  const source = useMemo<Source | undefined>(() => (blob ? { blob } : undefined), [blob]);
  const [preview, setPreview] = useState<{ source: Source; url: string }>();
  useEffect(() => {
    const url = source && URL.createObjectURL(source.blob);
    // oxlint-disable-next-line react/set-state-in-effect -- Blob URL Lifetime - Publish only URLs allocated after commit so abandoned renders cannot leak them.
    setPreview(source && url ? { source, url } : undefined);
    if (url) return () => URL.revokeObjectURL(url);
  }, [source]);
  return preview?.source === source ? preview?.url : undefined;
}
