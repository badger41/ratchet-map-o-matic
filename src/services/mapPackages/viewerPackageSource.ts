import { PackedMapAssetPackage } from '../mapAssets/mapAssetPackage';
import {
  loadIndexedDbRenderPackage,
  parseIndexedDbPackageSource,
  toIndexedDbPackageSource
} from '../renderPackages/indexedDbRenderPackageStore';
import {
  loadMapPackage,
  loadMapPackageFromAssetPackage
} from './loadMapPackage';

export async function loadViewerPackageSource(source: string) {
  const packageId = parseIndexedDbPackageSource(source);
  if (!packageId) {
    return loadMapPackage(source);
  }

  const record = await loadIndexedDbRenderPackage(packageId);
  const assetPackage = new PackedMapAssetPackage(
    record.packedBytes,
    record.entries,
    toIndexedDbPackageSource(record.id)
  );

  try {
    return await loadMapPackageFromAssetPackage(assetPackage, {
      manifestPath: 'manifest.json',
      manifestUrl: toIndexedDbPackageSource(record.id),
      manifestBaseUrl: assetPackage.baseUrl
    });
  } catch (error: unknown) {
    assetPackage.dispose();
    throw error;
  }
}
