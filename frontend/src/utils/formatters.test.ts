import { describe, it, expect } from 'vitest';
import { formatNumber, formatDuration } from './formatters';

describe('formatNumber', () => {
  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats small numbers', () => {
    expect(formatNumber(5)).toBe('5.00');
    expect(formatNumber(15)).toBe('15.0');
    expect(formatNumber(99)).toBe('99.0');
  });

  it('formats thousands', () => {
    expect(formatNumber(19823)).toBe('19.8k');
    expect(formatNumber(1984)).toBe('1.98k');
    expect(formatNumber(1000)).toBe('1.00k');
  });

  it('formats millions', () => {
    expect(formatNumber(1500000)).toBe('1.50M');
    expect(formatNumber(198236461)).toBe('198M');
    expect(formatNumber(1000000)).toBe('1.00M');
  });

  it('formats large numbers', () => {
    expect(formatNumber(1500000000)).toBe('1.50B');
    expect(formatNumber(1500000000000)).toBe('1.50T');
  });

  it('formats negative numbers', () => {
    expect(formatNumber(-12345)).toBe('-12.3k');
    expect(formatNumber(-1500000)).toBe('-1.50M');
  });

});

describe('formatDuration', () => {
  it('formats zero as N/A', () => {
    expect(formatDuration(0)).toBe('N/A');
  });

  it('formats seconds only', () => {
    expect(formatDuration(5)).toBe('5s');
    expect(formatDuration(15)).toBe('15s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(75)).toBe('1m 15s');
    expect(formatDuration(315)).toBe('5m 15s');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3665)).toBe('1h 1m 5s');
    expect(formatDuration(3915)).toBe('1h 5m 15s');
  });

  it('formats days, hours, minutes, and seconds', () => {
    expect(formatDuration(1928371)).toBe('22d 7h 39m 31s');
  });

});
