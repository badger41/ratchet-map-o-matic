import * as THREE from 'three/webgpu';
import type {
  GltfExportEntry,
  TieColorTable,
  TieInstanceRecord
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  gltfToPs2BasisMatrix,
  ps2ToGltfBasisMatrix,
  tieInstanceChunkCellSize,
  tieInstanceChunkMaxRecords,
  type PreparedTieRecord
} from './TieTypes';
import { numberValue } from './tieUtils';

export function buildTieEntryMap(entries: GltfExportEntry[]): Map<number, GltfExportEntry> {
  const map = new Map<number, GltfExportEntry>();
  for (const entry of entries) {
    const modelId = numberValue(entry.ModelId);
    if (modelId !== null) {
      map.set(modelId, entry);
    }
  }

  return map;
}

export function groupRecordsByClassId(records: TieInstanceRecord[]): Map<number, TieInstanceRecord[]> {
  const groups = new Map<number, TieInstanceRecord[]>();
  for (const record of records) {
    const group = groups.get(record.classId);
    if (group) {
      group.push(record);
    } else {
      groups.set(record.classId, [record]);
    }
  }

  return groups;
}

export function prepareTieRecord(record: TieInstanceRecord, colorTable: TieColorTable | null): PreparedTieRecord {
  const instanceMatrix = buildTieInstanceMatrix(record);
  const isMirrored = instanceMatrix.determinant() < 0;
  return {
    source: record,
    colorEntry: colorTable?.byInstanceId.get(record.index) ?? null,
    instanceMatrix,
    mirroredKey: isMirrored ? 'mirrored' : 'normal',
    isMirrored
  };
}

export function chunkTieRecords(records: PreparedTieRecord[]): PreparedTieRecord[][] {
  if (records.length === 0) {
    return [];
  }

  const recordsByCell = new Map<string, PreparedTieRecord[]>();
  for (const record of records) {
    const cellKey = tieRecordCellKey(record);
    const cellRecords = recordsByCell.get(cellKey);
    if (cellRecords) {
      cellRecords.push(record);
    } else {
      recordsByCell.set(cellKey, [record]);
    }
  }

  const chunks: PreparedTieRecord[][] = [];
  for (const cellRecords of recordsByCell.values()) {
    const sortedRecords = cellRecords.length > tieInstanceChunkMaxRecords
      ? [...cellRecords].sort(compareTieRecordPosition)
      : cellRecords;
    for (let index = 0; index < sortedRecords.length; index += tieInstanceChunkMaxRecords) {
      chunks.push(sortedRecords.slice(index, index + tieInstanceChunkMaxRecords));
    }
  }

  return chunks;
}

function buildTieInstanceMatrix(record: TieInstanceRecord): THREE.Matrix4 {
  const v0 = record.matrixRows[0];
  const v1 = record.matrixRows[1];
  const v2 = record.matrixRows[2];
  const position = record.position;
  const sourceMatrix = new THREE.Matrix4().set(
    v0[0], v1[0], v2[0], position[0],
    v0[1], v1[1], v2[1], position[1],
    v0[2], v1[2], v2[2], position[2],
    0, 0, 0, 1
  );

  return new THREE.Matrix4()
    .copy(ps2ToGltfBasisMatrix)
    .multiply(sourceMatrix)
    .multiply(gltfToPs2BasisMatrix);
}

function tieRecordCellKey(record: PreparedTieRecord): string {
  const elements = record.instanceMatrix.elements;
  return [
    Math.floor(elements[12] / tieInstanceChunkCellSize),
    Math.floor(elements[13] / tieInstanceChunkCellSize),
    Math.floor(elements[14] / tieInstanceChunkCellSize)
  ].join(',');
}

function compareTieRecordPosition(left: PreparedTieRecord, right: PreparedTieRecord): number {
  const leftElements = left.instanceMatrix.elements;
  const rightElements = right.instanceMatrix.elements;
  return (leftElements[12] - rightElements[12])
    || (leftElements[14] - rightElements[14])
    || (leftElements[13] - rightElements[13]);
}
