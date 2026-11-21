import { checkDevice, checkProblem, checkReadingState } from '../api/guards.gen.js';
import type { S } from './types';

export function validProblem(value: unknown, status: number): value is S['Problem'] {
  return checkProblem(value) && value.status === status && value.backup_path_issue === undefined;
}
export function validState(value: unknown, documentId: string): value is S['ReadingState'] {
  return checkReadingState(value) && value.document_id === documentId;
}
export function validDevice(value: unknown, id: string): value is S['Device'] {
  return checkDevice(value) && value.id === id;
}
