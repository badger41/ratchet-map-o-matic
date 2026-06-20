export interface WadFetchProgress {
  loaded: number;
  total: number | null;
}

export async function fetchWadBytes(
  url: string,
  onProgress?: (progress: WadFetchProgress) => void
): Promise<Uint8Array> {
  const sourceUrl = normalizeWadUrl(url);
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch WAD: ${response.status} ${response.statusText}`);
  }

  const total = parseContentLength(response.headers.get('content-length'));
  onProgress?.({ loaded: 0, total });

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total });
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  onProgress?.({ loaded, total: total ?? loaded });
  return bytes;
}

function normalizeWadUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('WAD URL is empty.');
  }

  return trimmed;
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
