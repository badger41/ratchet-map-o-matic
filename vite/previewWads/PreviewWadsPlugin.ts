import { execFile } from 'node:child_process';
import type { Plugin, ViteDevServer } from 'vite';

const sectorSize = 0x800;

export abstract class PreviewWadsPlugin implements Plugin {
  abstract readonly name: string;
  readonly apply = 'serve' as const;
  protected abstract readonly mountPath: string;
  protected abstract readonly isoPath: string;
  protected abstract readonly wadDirectory: string;
  protected abstract readonly sizes: ReadonlyMap<number, number>;

  abstract normalize(bytes: Uint8Array): Buffer;

  configureServer(server: ViteDevServer): void {
    server.middlewares.use(this.mountPath, (request, response, next) => {
      const match = /^\/level(\d+)\.wad$/i.exec(request.url?.split('?')[0] ?? '');
      const level = match ? Number(match[1]) : -1;
      const size = this.sizes.get(level);
      if (!size) {
        next();
        return;
      }

      const normalizedSize = PreviewWadsPlugin.sectorAlignedSize(size);
      if (request.method === 'HEAD') {
        response.setHeader('Content-Type', 'application/octet-stream');
        response.setHeader('Content-Length', normalizedSize);
        response.end();
        return;
      }

      // ponytail: buffer one local WAD; stream-transform if preview WADs get much larger.
      const extractor = execFile(
        '7z',
        ['x', '-so', this.isoPath, `${this.wadDirectory}/LEVEL${level}.WAD`],
        { encoding: null, maxBuffer: normalizedSize },
        (error, stdout) => {
          if (response.destroyed) {
            return;
          }
          if (error) {
            response.statusCode = 500;
            response.end(error.message);
            return;
          }

          try {
            const normalizedBytes = this.normalize(stdout);
            response.setHeader('Content-Type', 'application/octet-stream');
            response.setHeader('Content-Length', normalizedBytes.byteLength);
            response.end(normalizedBytes);
          } catch (normalizationError) {
            response.statusCode = 500;
            response.end(normalizationError instanceof Error ? normalizationError.message : String(normalizationError));
          }
        }
      );
      response.on('close', () => extractor.kill());
    });
  }

  protected static sectorAlignedSize(size: number): number {
    return Math.ceil(size / sectorSize) * sectorSize;
  }

  protected static sectorAlignedBuffer(bytes: Uint8Array): Buffer {
    const normalized = Buffer.alloc(PreviewWadsPlugin.sectorAlignedSize(bytes.byteLength));
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).copy(normalized);
    return normalized;
  }
}
