import { dlMaps } from './dlMaps';
import { uyaMaps } from './uyaMaps';
import type { MapDefinition } from './mapTypes';

export type {
  MapCategory,
  MapDefinition,
  MapSourceKind,
  RatchetGameId
} from './mapTypes';

export const mapCatalog: MapDefinition[] = [
  ...uyaMaps,
  ...dlMaps,
];

export const defaultMap = mapCatalog[0];
