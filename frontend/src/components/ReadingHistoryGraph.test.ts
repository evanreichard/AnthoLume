import { describe, expect, it } from 'vitest';
import { getSVGGraphData } from './ReadingHistoryGraph';

// Test data matching Go test exactly
const testInput = [
  { date: '2024-01-01', minutes_read: 10 },
  { date: '2024-01-02', minutes_read: 90 },
  { date: '2024-01-03', minutes_read: 50 },
  { date: '2024-01-04', minutes_read: 5 },
  { date: '2024-01-05', minutes_read: 10 },
  { date: '2024-01-06', minutes_read: 5 },
  { date: '2024-01-07', minutes_read: 70 },
  { date: '2024-01-08', minutes_read: 60 },
  { date: '2024-01-09', minutes_read: 50 },
  { date: '2024-01-10', minutes_read: 90 },
];

const svgWidth = 500;
const svgHeight = 100;

describe('ReadingHistoryGraph', () => {
  describe('getSVGGraphData', () => {
    it('should match exactly', () => {
      const result = getSVGGraphData(testInput, svgWidth, svgHeight);

      // Expected values from Go test
      const expectedBezierPath =
        'M 50,95 C63,95 80,50 100,50 C120,50 128,73 150,73 C172,73 180,98 200,98 C220,98 230,95 250,95 C270,95 279,98 300,98 C321,98 330,62 350,62 C370,62 380,67 400,67 C420,67 430,73 450,73 C470,73 489,50 500,50';
      const expectedBezierFill = 'L 500,98 L 50,98 Z';
      const expectedWidth = 500;
      const expectedHeight = 100;
      const expectedOffset = 50;

      expect(result.BezierPath).toBe(expectedBezierPath);
      expect(result.BezierFill).toBe(expectedBezierFill);
      expect(svgWidth).toBe(expectedWidth);
      expect(svgHeight).toBe(expectedHeight);
      expect(result.Offset).toBe(expectedOffset);

      // Verify line points are integers like Go
      result.LinePoints.forEach((p, _i) => {
        expect(Number.isInteger(p.x)).toBe(true);
        expect(Number.isInteger(p.y)).toBe(true);
      });

      // Expected line points from Go calculation:
      // idx 0: itemSize=5, itemY=95, lineX=50
      // idx 1: itemSize=45, itemY=55, lineX=100
      // idx 2: itemSize=25, itemY=75, lineX=150
      // ...and so on
    });
  });
});
