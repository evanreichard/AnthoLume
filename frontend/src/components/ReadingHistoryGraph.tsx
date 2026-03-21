import type { GraphDataPoint } from '../generated/model';

interface ReadingHistoryGraphProps {
  data: GraphDataPoint[];
}

export interface SVGPoint {
  x: number;
  y: number;
}

/**
 * Generates bezier control points for smooth curves
 */
function getSVGBezierOpposedLine(
  pointA: SVGPoint,
  pointB: SVGPoint
): { Length: number; Angle: number } {
  const lengthX = pointB.x - pointA.x;
  const lengthY = pointB.y - pointA.y;

  // Go uses int() which truncates toward zero, JavaScript Math.trunc matches this
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
  // First / Last Point
  let pPrev = prevPoint;
  let pNext = nextPoint;
  if (!pPrev) {
    pPrev = currentPoint;
  }
  if (!pNext) {
    pNext = currentPoint;
  }

  // Modifiers
  const smoothingRatio: number = 0.2;
  const directionModifier: number = isReverse ? Math.PI : 0;

  const opposingLine = getSVGBezierOpposedLine(pPrev, pNext);
  const lineAngle: number = opposingLine.Angle + directionModifier;
  const lineLength: number = opposingLine.Length * smoothingRatio;

  // Calculate Control Point - Go converts everything to int
  // Note: int(math.Cos(...) * lineLength) means truncate product, not truncate then multiply
  return {
    x: Math.floor(currentPoint.x + Math.trunc(Math.cos(lineAngle) * lineLength)),
    y: Math.floor(currentPoint.y + Math.trunc(Math.sin(lineAngle) * lineLength)),
  };
}

/**
 * Generates the bezier path for the graph
 */
function getSVGBezierPath(points: SVGPoint[]): string {
  if (points.length === 0) {
    return '';
  }

  let bezierSVGPath: string = '';

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (index === 0) {
      bezierSVGPath += `M ${point.x},${point.y}`;
    } else {
      const pointPlusOne = points[index + 1];
      const pointMinusOne = points[index - 1];
      const pointMinusTwo: SVGPoint | null = index - 2 >= 0 ? points[index - 2] : null;

      const startControlPoint: SVGPoint = getBezierControlPoint(
        pointMinusOne,
        pointMinusTwo,
        point,
        false
      );
      const endControlPoint: SVGPoint = getBezierControlPoint(
        point,
        pointMinusOne,
        pointPlusOne || point,
        true
      );

      // Go converts all coordinates to int
      bezierSVGPath += ` C${startControlPoint.x},${startControlPoint.y} ${endControlPoint.x},${endControlPoint.y} ${point.x},${point.y}`;
    }
  }

  return bezierSVGPath;
}

export interface SVGGraphData {
  LinePoints: SVGPoint[];
  BezierPath: string;
  BezierFill: string;
  Offset: number;
}

/**
 * Get SVG Graph Data
 */
export function getSVGGraphData(
  inputData: GraphDataPoint[],
  svgWidth: number,
  svgHeight: number
): SVGGraphData {
  // Derive Height
  let maxHeight: number = 0;
  for (const item of inputData) {
    if (item.minutes_read > maxHeight) {
      maxHeight = item.minutes_read;
    }
  }

  // Vertical Graph Real Estate
  const sizePercentage: number = 0.5;

  // Scale Ratio -> Desired Height
  const sizeRatio: number = (svgHeight * sizePercentage) / maxHeight;

  // Point Block Offset
  const blockOffset: number = Math.floor(svgWidth / inputData.length);

  // Line & Bar Points
  const linePoints: SVGPoint[] = [];

  // Bezier Fill Coordinates (Max X, Min X, Max Y)
  let maxBX: number = 0;
  let maxBY: number = 0;
  let minBX: number = 0;

  for (let idx = 0; idx < inputData.length; idx++) {
    // Go uses int conversion
    const itemSize = Math.floor(inputData[idx].minutes_read * sizeRatio);
    const itemY = svgHeight - itemSize;
    const lineX = (idx + 1) * blockOffset;

    linePoints.push({
      x: lineX,
      y: itemY,
    });

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

  // Return Data
  return {
    LinePoints: linePoints,
    BezierPath: getSVGBezierPath(linePoints),
    BezierFill: `L ${Math.floor(maxBX)},${Math.floor(maxBY)} L ${Math.floor(minBX + blockOffset)},${Math.floor(maxBY)} Z`,
    Offset: blockOffset,
  };
}

/**
 * Formats a date string to YYYY-MM-DD format (ISO-like)
 * Note: The date string from the API is already in YYYY-MM-DD format,
 * but since JavaScript Date parsing can add timezone offsets, we use UTC
 * methods to ensure we get the correct date.
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  // Use UTC methods to avoid timezone offset issues
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * ReadingHistoryGraph component
 *
 * Displays a bezier curve graph of daily reading totals with hover tooltips.
 * Exact copy of Go template implementation.
 */
export default function ReadingHistoryGraph({ data }: ReadingHistoryGraphProps) {
  const svgWidth = 800;
  const svgHeight = 70;

  if (!data || data.length < 2) {
    return (
      <div className="relative flex h-24 items-center justify-center bg-gray-100 dark:bg-gray-600">
        <p className="text-gray-400 dark:text-gray-300">No data available</p>
      </div>
    );
  }

  const {
    BezierPath,
    BezierFill,
    LinePoints: _linePoints,
  } = getSVGGraphData(data, svgWidth, svgHeight);

  return (
    <div className="relative">
      <svg viewBox={`26 0 755 ${svgHeight}`} preserveAspectRatio="none" width="100%" height="6em">
        <path fill="#316BBE" fillOpacity="0.5" stroke="none" d={`${BezierPath} ${BezierFill}`} />
        <path fill="none" stroke="#316BBE" d={BezierPath} />
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
            onClick
            className="w-full opacity-0 hover:opacity-100"
            style={{
              background:
                'linear-gradient(rgba(128, 128, 128, 0.5), rgba(128, 128, 128, 0.5)) no-repeat center/2px 100%',
            }}
          >
            <div
              className="pointer-events-none absolute top-3 flex flex-col items-center rounded p-2 text-xs dark:text-white"
              style={{
                transform: 'translateX(-50%)',
                left: '50%',
                backgroundColor: 'rgba(128, 128, 128, 0.2)',
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
