import {
  mapLoadStageDefinitions,
  type MapLoadStageId,
  type MapLoadStageStatus,
  type MapLoadStageUpdate
} from '../../services/mapLoading/deadlockedMapLoadPipeline';

export type MapLoaderPhase = 'welcome' | 'loading' | 'ready' | 'error';

export interface MapLoadStageState {
  id: MapLoadStageId;
  label: string;
  status: MapLoadStageStatus;
  detail: string;
  loaded: number | null;
  total: number | null;
}

export function createMapLoadStages(activeStage: MapLoadStageId | null = null): MapLoadStageState[] {
  return mapLoadStageDefinitions.map((definition) => ({
    ...definition,
    status: activeStage === definition.id ? 'active' : 'pending',
    detail: activeStage === definition.id ? 'Starting' : '',
    loaded: null,
    total: null
  }));
}

export function applyStageUpdate(
  stages: MapLoadStageState[],
  update: MapLoadStageUpdate
): MapLoadStageState[] {
  return stages.map((stage) => {
    if (stage.id !== update.id) {
      return stage;
    }

    return {
      ...stage,
      status: update.status,
      detail: update.detail,
      loaded: update.loaded,
      total: update.total
    };
  });
}

export function markActiveStageFailed(stages: MapLoadStageState[], message: string): MapLoadStageState[] {
  const active = stages.find((stage) => stage.status === 'active');
  if (!active) {
    return stages;
  }

  return stages.map((stage) => stage.id === active.id
    ? { ...stage, status: 'error', detail: message }
    : stage);
}

export function stageProgressValue(stage: MapLoadStageState): number {
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

export function stageColor(status: MapLoadStageStatus): string {
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
