interface StreamToFileOptions {
  suggestedName: string;
  mimeType: string;
  extension: string;
}

/**
 * Streams a response body to a user-chosen file. Uses the File System Access API when
 * available (large-file friendly, no memory buffering); otherwise falls back to a
 * blob/object-URL download. Returns whether the download completed (false if the user
 * cancelled or the browser lacks any download capability).
 */
export async function streamResponseToFile(
  response: Response,
  { suggestedName, mimeType, extension }: StreamToFileOptions
): Promise<boolean> {
  if ('showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'File', accept: { [mimeType]: [extension] } }],
      });

      const writable = await handle.createWritable();
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Unable to read response');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
      }

      await writable.close();
      return true;
    } catch (err) {
      // User-cancelled picker resolves as AbortError; treat as "no download".
      if ((err as Error).name === 'AbortError') return false;
      throw err;
    }
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}

export function backupFilename(): string {
  return `AnthoLumeBackup_${new Date().toISOString().replace(/[:.]/g, '')}.zip`;
}
