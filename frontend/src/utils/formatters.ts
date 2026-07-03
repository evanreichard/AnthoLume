/**
 * FormatNumber takes a number and returns a human-readable string.
 * For example: 19823 -> "19.8k", 1500000 -> "1.50M"
 */
export function formatNumber(input: number): string {
  if (input === 0) {
    return '0';
  }

  // Handle negative numbers
  const negative = input < 0;
  if (negative) {
    input = -input;
  }

  const abbreviations = ['', 'k', 'M', 'B', 'T'];
  const abbrevIndex = Math.floor(Math.log10(input) / 3);

  // Bounds check
  const safeIndex = Math.min(abbrevIndex, abbreviations.length - 1);

  const scaledNumber = input / Math.pow(10, safeIndex * 3);

  let result: string;
  if (scaledNumber >= 100) {
    result = `${Math.round(scaledNumber)}${abbreviations[safeIndex]}`;
  } else if (scaledNumber >= 10) {
    result = `${scaledNumber.toFixed(1)}${abbreviations[safeIndex]}`;
  } else {
    result = `${scaledNumber.toFixed(2)}${abbreviations[safeIndex]}`;
  }

  if (negative) {
    result = `-${result}`;
  }

  return result;
}

/**
 * FormatDuration takes duration in seconds and returns a human-readable string.
 * For example: 1928371 seconds -> "22d 7h 39m 31s"
 */
export function formatDuration(seconds: number): string {
  if (seconds === 0) {
    return 'N/A';
  }

  const parts: string[] = [];

  const days = Math.floor(seconds / (60 * 60 * 24));
  seconds %= 60 * 60 * 24;
  const hours = Math.floor(seconds / (60 * 60));
  seconds %= 60 * 60;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
}
