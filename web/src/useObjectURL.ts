import { useEffect, useMemo, useState } from 'react';

type Source = { blob: Blob };

export function useObjectURL(blob: Blob | null | undefined): string | undefined {
  // Selection Identity - Switching back to a previous blob must not reuse its revoked URL.
  const source = useMemo<Source | undefined>(() => blob ? { blob } : undefined, [blob]);
  const [preview, setPreview] = useState<{ source: Source; url: string }>();
  useEffect(() => {
    if (!source) { setPreview(undefined); return; }
    const url = URL.createObjectURL(source.blob);
    setPreview({ source, url });
    return () => URL.revokeObjectURL(url);
  }, [source]);
  return preview?.source === source ? preview?.url : undefined;
}
