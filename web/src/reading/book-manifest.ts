import type { CSSDropCounts } from './css-policy';
import type { SourceIntegrity, ZipIndex } from './source';
export type DocumentInfo = { root: string; namespace: string | null; ids: string[]; svgIds: string[]; words: number; bytes: number; head: boolean; body: boolean };
export type BookManifest = { version: 2; lazy?: boolean; integrity: SourceIntegrity | null; index: ZipIndex; opf: string; spine: string[]; navigation: string[]; roles: [string, string][]; documents: Record<string, DocumentInfo>; dependencies: [string, string[]][]; staticDependencies: [string, string[]][]; images: Record<string, { width: number; height: number }>; pixels: Record<string, number>; title: string | null; author: string | null; cssDrops?: CSSDropCounts };
