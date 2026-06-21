import type {
  MapSceneLoadStageId,
  MapSceneLoadStageStatus,
  MapSceneLoadStageUpdate
} from '../../services/mapPackages/mapPackageTypes';

export interface MapViewerStageDefinition {
  id: MapSceneLoadStageId;
  label: string;
}

export interface MapViewerStageState extends MapViewerStageDefinition {
  status: MapSceneLoadStageStatus;
  detail: string;
  loaded: number | null;
  total: number | null;
}

export const mapViewerStageDefinitions: MapViewerStageDefinition[] = [
  { id: 'manifest', label: 'Read package manifests' },
  { id: 'tfrag', label: 'Load terrain' },
  { id: 'compile', label: 'Scene setup' }
];

export function createMapViewerStages(activeStage: MapSceneLoadStageId | null = null): MapViewerStageState[] {
  return mapViewerStageDefinitions.map((definition) => ({
    ...definition,
    status: activeStage === definition.id ? 'active' : 'pending',
    detail: activeStage === definition.id ? 'Starting' : '',
    loaded: null,
    total: null
  }));
}

export function applyViewerStageUpdate(
  stages: MapViewerStageState[],
  update: MapSceneLoadStageUpdate
): MapViewerStageState[] {
  return stages.map((stage) => {
    if (stage.id !== update.id) {
      return stage;
    }

    return {
      ...stage,
      status: update.status,
      detail: update.detail ?? stage.detail,
      loaded: update.loaded ?? null,
      total: update.total ?? null
    };
  });
}

export function markActiveViewerStageFailed(stages: MapViewerStageState[], message: string): MapViewerStageState[] {
  const active = stages.find((stage) => stage.status === 'active');
  const target = active ?? stages.find((stage) => stage.status === 'pending');
  if (!target) {
    return stages;
  }

  return stages.map((stage) => stage.id === target.id
    ? { ...stage, status: 'error', detail: message }
    : stage);
}

export function viewerStageProgressValue(stage: MapViewerStageState): number {
  if (stage.status === 'done') {
    return 100;
  }

  if (stage.status === 'error') {
    return 100;
  }

  if (stage.status === 'pending') {
    return 0;
  }

  if (stage.total && stage.total > 0 && stage.loaded !== null) {
    return Math.min(99, Math.max(4, (stage.loaded / stage.total) * 100));
  }

  return 45;
}

export function viewerStageColor(status: MapSceneLoadStageStatus): string {
  switch (status) {
    case 'active':
      return 'blue';
    case 'done':
      return 'teal';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
}
