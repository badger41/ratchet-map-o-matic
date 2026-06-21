import * as THREE from 'three/webgpu';
import type {
  GltfExportEntry,
  ShrubInstanceRecord
} from '../../../../services/mapPackages/mapPackageTypes';
import {
  gltfToPs2BasisMatrix,
  ps2ToGltfBasisMatrix,
  shrubInstanceChunkCellSize,
  shrubInstanceChunkMaxRecords,
  type PreparedShrubRecord
} from './ShrubTypes';
import { numberValue } from '../ties/tieUtils';

export function buildShrubEntryMap(entries: GltfExportEntry[]): Map<number, GltfExportEntry> {
  const map = new Map<number, GltfExportEntry>();
  for (const entry of entries) {
    const modelId = numberValue(entry.ModelId);
    if (modelId !== null) {
      map.set(modelId, entry);
    }
  }

  return map;
}

export function groupShrubRecordsByClassId(records: ShrubInstanceRecord[]): Map<number, ShrubInstanceRecord[]> {
  const groups = new Map<number, ShrubInstanceRecord[]>();
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

export function prepareShrubRecord(record: ShrubInstanceRecord): PreparedShrubRecord {
  const instanceMatrix = buildShrubInstanceMatrix(record);
  const isMirrored = instanceMatrix.determinant() < 0;
  return {
    source: record,
    instanceMatrix,
    mirroredKey: isMirrored ? 'mirrored' : 'normal',
    isMirrored,
    ambientColor: shrubInstanceAmbientColor(record.lightRgb)
  };
}

export function chunkShrubRecords(records: PreparedShrubRecord[]): PreparedShrubRecord[][] {
  if (records.length === 0) {
    return [];
  }

  const recordsByCell = new Map<string, PreparedShrubRecord[]>();
  for (const record of records) {
    const cellKey = shrubRecordCellKey(record);
    const cellRecords = recordsByCell.get(cellKey);
    if (cellRecords) {
      cellRecords.push(record);
    } else {
      recordsByCell.set(cellKey, [record]);
    }
  }

  const chunks: PreparedShrubRecord[][] = [];
  for (const cellRecords of recordsByCell.values()) {
    const sortedRecords = cellRecords.length > shrubInstanceChunkMaxRecords
      ? [...cellRecords].sort(compareShrubRecordPosition)
      : cellRecords;
    for (let index = 0; index < sortedRecords.length; index += shrubInstanceChunkMaxRecords) {
      chunks.push(sortedRecords.slice(index, index + shrubInstanceChunkMaxRecords));
    }
  }

  return chunks;
}

function buildShrubInstanceMatrix(record: ShrubInstanceRecord): THREE.Matrix4 {
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

function shrubRecordCellKey(record: PreparedShrubRecord): string {
  const elements = record.instanceMatrix.elements;
  return [
    Math.floor(elements[12] / shrubInstanceChunkCellSize),
    Math.floor(elements[13] / shrubInstanceChunkCellSize),
    Math.floor(elements[14] / shrubInstanceChunkCellSize)
  ].join(',');
}

function compareShrubRecordPosition(left: PreparedShrubRecord, right: PreparedShrubRecord): number {
  const leftElements = left.instanceMatrix.elements;
  const rightElements = right.instanceMatrix.elements;
  return (leftElements[12] - rightElements[12])
    || (leftElements[14] - rightElements[14])
    || (leftElements[13] - rightElements[13]);
}

function shrubInstanceAmbientColor(rgb: [number, number, number]): [number, number, number] {
  const scale = 1 / 255;
  return [
    sanitizeLightComponent(rgb[0]) * scale,
    sanitizeLightComponent(rgb[1]) * scale,
    sanitizeLightComponent(rgb[2]) * scale
  ];
}

function sanitizeLightComponent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 128;
}
