import type { GraphDataPoint } from '../generated/model';

interface ReadingHistoryGraphProps {
  data: GraphDataPoint[];
}

export interface SVGPoint {
  x: number;
  y: number;
}

function getSVGBezierOpposedLine(
  pointA: SVGPoint,
  pointB: SVGPoint
): { Length: number; Angle: number } {
  const lengthX = pointB.x - pointA.x;
  const lengthY = pointB.y - pointA.y;

  return {
    Length: Math.floor(Math.sqrt(lengthX * lengthX + lengthY * lengthY)),
    Angle: Math.trunc(Math.atan2(lengthY, lengthX)),
  };
}

function getBezierControlPoint(
  currentPoint: SVGPoint,
  prevPoint: SVGPoint | null,
  nextPoint: SVGPoint | null,
  isReverse: boolean
): SVGPoint {
  let pPrev = prevPoint;
  let pNext = nextPoint;
  if (!pPrev) {
    pPrev = currentPoint;
  }
  if (!pNext) {
    pNext = currentPoint;
  }

  const smoothingRatio = 0.2;
  const directionModifier = isReverse ? Math.PI : 0;

  const opposingLine = getSVGBezierOpposedLine(pPrev, pNext);
  const lineAngle = opposingLine.Angle + directionModifier;
  const lineLength = opposingLine.Length * smoothingRatio;

  return {
    x: Math.floor(currentPoint.x + Math.trunc(Math.cos(lineAngle) * lineLength)),
    y: Math.floor(currentPoint.y + Math.trunc(Math.sin(lineAngle) * lineLength)),
  };
}

function getSVGBezierPath(points: SVGPoint[]): string {
  if (points.length === 0) {
    return '';
  }

  let bezierSVGPath = '';

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point) {
      continue;
    }

    if (index === 0) {
      bezierSVGPath += `M ${point.x},${point.y}`;
      continue;
    }

    const pointMinusOne = points[index - 1];
    if (!pointMinusOne) {
      continue;
    }

    const pointPlusOne = points[index + 1] ?? point;
    const pointMinusTwo = index - 2 >= 0 ? (points[index - 2] ?? null) : null;

    const startControlPoint = getBezierControlPoint(pointMinusOne, pointMinusTwo, point, false);
    const endControlPoint = getBezierControlPoint(point, pointMinusOne, pointPlusOne, true);

    bezierSVGPath += ` C${startControlPoint.x},${startControlPoint.y} ${endControlPoint.x},${endControlPoint.y} ${point.x},${point.y}`;
  }

  return bezierSVGPath;
}

export interface SVGGraphData {
  LinePoints: SVGPoint[];
  BezierPath: string;
  BezierFill: string;
  Offset: number;
}

export function getSVGGraphData(
  inputData: GraphDataPoint[],
  svgWidth: number,
  svgHeight: number
): SVGGraphData {
  let maxHeight = 0;
  for (const item of inputData) {
    if (item.minutes_read > maxHeight) {
      maxHeight = item.minutes_read;
    }
  }

  const sizePercentage = 0.5;
  const sizeRatio = maxHeight > 0 ? (svgHeight * sizePercentage) / maxHeight : 0;
  const blockOffset = inputData.length > 0 ? Math.floor(svgWidth / inputData.length) : 0;

  const linePoints: SVGPoint[] = [];

  let maxBX = 0;
  let maxBY = 0;
  let minBX = 0;

  for (let idx = 0; idx < inputData.length; idx++) {
    const item = inputData[idx];
    if (!item) {
      continue;
    }

    const itemSize = Math.floor(item.minutes_read * sizeRatio);
    const itemY = svgHeight - itemSize;
    const lineX = (idx + 1) * blockOffset;

    linePoints.push({ x: lineX, y: itemY });

    if (lineX > maxBX) {
      maxBX = lineX;
    }

    if (lineX < minBX) {
      minBX = lineX;
    }

    if (itemY > maxBY) {
      maxBY = itemY;
    }
  }

  return {
    LinePoints: linePoints,
    BezierPath: getSVGBezierPath(linePoints),
    BezierFill: `L ${Math.floor(maxBX)},${Math.floor(maxBY)} L ${Math.floor(minBX + blockOffset)},${Math.floor(maxBY)} Z`,
    Offset: blockOffset,
  };
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function ReadingHistoryGraph({ data }: ReadingHistoryGraphProps) {
  const svgWidth = 800;
  const svgHeight = 70;

  if (!data || data.length < 2) {
    return (
      <div className="relative flex h-24 items-center justify-center bg-surface-muted">
        <p className="text-content-subtle">No data available</p>
      </div>
    );
  }

  const { BezierPath, BezierFill } = getSVGGraphData(data, svgWidth, svgHeight);

  return (
    <div className="relative">
      <svg viewBox={`26 0 755 ${svgHeight}`} preserveAspectRatio="none" width="100%" height="6em">
        <path fill="rgb(var(--secondary-600))" fillOpacity="0.5" stroke="none" d={`${BezierPath} ${BezierFill}`} />
        <path fill="none" stroke="rgb(var(--secondary-600))" d={BezierPath} />
      </svg>
      <div
        className="absolute top-0 flex size-full"
        style={{
          width: 'calc(100% * 31 / 30)',
          transform: 'translateX(-50%)',
          left: '50%',
        }}
      >
        {data.map((point, i) => (
          <div
            key={i}
            className="w-full opacity-0 hover:opacity-100"
            style={{
              background:
                'linear-gradient(rgba(128, 128, 128, 0.5), rgba(128, 128, 128, 0.5)) no-repeat center/2px 100%',
            }}
          >
            <div
              className="pointer-events-none absolute top-3 flex flex-col items-center rounded bg-surface/80 p-2 text-xs text-content"
              style={{
                transform: 'translateX(-50%)',
                left: '50%',
              }}
            >
              <span>{formatDate(point.date)}</span>
              <span>{point.minutes_read} minutes</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
