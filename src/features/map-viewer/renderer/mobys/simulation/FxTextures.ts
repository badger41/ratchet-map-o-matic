import * as THREE from 'three/webgpu';
import {
  dirnamePackagePath,
  joinPackagePath
} from '../../../../../services/mapAssets/mapAssetPackage.ts';
import type { LoadedMapPackage } from '../../../../../services/mapPackages/mapPackageTypes.ts';
import { numberValue } from '../../../../../shared/valueParsing.ts';

interface FxTextureManifest {
  Textures?: Array<{
    Index?: unknown;
    Path?: unknown;
  }>;
}

const dlFxLevelTextureBaseId = 0x62;
const uyaFxLevelTextureBaseId = 0x64;

export function fxLevelTextureBaseIdForGame(game: unknown): number {
  return typeof game === 'string' && ['GC', 'UYA'].includes(game.toUpperCase())
    ? uyaFxLevelTextureBaseId
    : dlFxLevelTextureBaseId;
}

export function resolveFxTextureUrl(
  textureUrls: Map<number, string>,
  pvarTextureId: number,
  fxLevelTextureBaseId: number
): string | null {
  return pvarTextureId >= 0 ? textureUrls.get(fxLevelTextureBaseId + pvarTextureId) ?? null : null;
}

export async function loadFxTextureUrls(mapPackage: LoadedMapPackage): Promise<Map<number, string>> {
  const assetRootPath = dirnamePackagePath(mapPackage.assetManifestPath);
  const manifest = await mapPackage.assetPackage.readOptionalJson<FxTextureManifest>(
    joinPackagePath(assetRootPath, 'fx/manifest.json')
  );
  const urls = new Map<number, string>();
  for (const entry of manifest?.Textures ?? []) {
    const index = numberValue(entry.Index);
    const path = stringValue(entry.Path);
    if (index === null || !path) {
      continue;
    }

    urls.set(index, await mapPackage.assetPackage.resolveUrl(joinPackagePath(assetRootPath, path)));
  }

  return urls;
}

export async function loadFxTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture | null> {
  try {
    const texture = await loader.loadAsync(url);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
