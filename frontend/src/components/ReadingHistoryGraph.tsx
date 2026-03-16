import type { GraphDataPoint } from '../generated/model';

interface ReadingHistoryGraphProps {
  data: GraphDataPoint[];
  width?: number;
  height?: number;
}

interface SVGPoint {
  x: number;
  y: number;
}

/**
 * Generates bezier control points for smooth curves
 */
function getBezierControlPoint(
  currentPoint: SVGPoint,
  prevPoint: SVGPoint | null,
  nextPoint: SVGPoint | null,
  isReverse: boolean
): SVGPoint {
  // First / Last Point
  const pPrev = prevPoint || currentPoint;
  const pNext = nextPoint || currentPoint;

  const smoothingRatio = 0.2;
  const directionModifier = isReverse ? Math.PI : 0;

  const lengthX = pNext.x - pPrev.x;
  const lengthY = pNext.y - pPrev.y;

  const length = Math.sqrt(lengthX * lengthX + lengthY * lengthY);
  const angle = Math.atan2(lengthY, lengthX) + directionModifier;
  const controlPointLength = length * smoothingRatio;

  return {
    x: currentPoint.x + Math.cos(angle) * controlPointLength,
    y: currentPoint.y + Math.sin(angle) * controlPointLength,
  };
}

/**
 * Generates the bezier path for the graph
 */
function generateBezierPath(points: SVGPoint[]): string {
  if (points.length === 0) return '';

  const first = points[0];
  let path = `M ${first.x},${first.y}`;

  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    const prev = points[i - 1];
    const prevPrev = i - 2 >= 0 ? points[i - 2] : current;
    const next = i + 1 < points.length ? points[i + 1] : current;

    const startControl = getBezierControlPoint(prev, prevPrev, current, false);
    const endControl = getBezierControlPoint(current, prev, next, true);

    path += ` C${startControl.x},${startControl.y} ${endControl.x},${endControl.y} ${current.x},${current.y}`;
  }

  return path;
}

/**
 * Calculate points for SVG rendering
 */
function calculatePoints(
  data: GraphDataPoint[],
  width: number,
  height: number
): SVGPoint[] {
  if (data.length === 0) return [];

  const maxMinutes = Math.max(...data.map((d) => d.minutes_read), 1);
  const paddingX = width * 0.03; // 3% padding on sides
  const paddingY = height * 0.1; // 10% padding on top/bottom
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;

  return data.map((point, index) => {
    const x = paddingX + (index / (data.length - 1)) * usableWidth;
    // Y is inverted (0 is top in SVG)
    const y =
      paddingY + usableHeight - (point.minutes_read / maxMinutes) * usableHeight;
    return { x, y };
  });
}

/**
 * Formats a date string
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * ReadingHistoryGraph component
 * 
 * Displays a bezier curve graph of daily reading totals with hover tooltips.
 */
export default function ReadingHistoryGraph({
  data,
  width = 800,
  height = 70,
}: ReadingHistoryGraphProps) {
  if (!data || data.length < 2) {
    return (
      <div className="relative flex h-24 items-center justify-center bg-gray-100 dark:bg-gray-600">
        <p className="text-gray-400 dark:text-gray-300">No data available</p>
      </div>
    );
  }

  const points = calculatePoints(data, width, height);
  const bezierPath = generateBezierPath(points);

  // Calculate fill path (closed loop for area fill)
  const firstX = Math.min(...points.map((p) => p.x));
  const lastX = Math.max(...points.map((p) => p.x));

  const areaPath = `${bezierPath} L ${lastX},${height} L ${firstX},${height} Z`;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        className="h-24"
      >
        {/* Area fill */}
        <path
          fill="#316BBE"
          fillOpacity="0.5"
          stroke="none"
          d={areaPath}
        />
        {/* Bezier curve line */}
        <path
          fill="none"
          stroke="#316BBE"
          strokeWidth="2"
          d={bezierPath}
        />
      </svg>

      {/* Hover overlays */}
      <div className="absolute top-0 size-full">
        {data.map((point, i) => {
          return (
            <div
              key={i}
              className="group relative flex-1 cursor-pointer"
              onClick={(e) => e.preventDefault()}
            >
              {/* Vertical indicator line on hover */}
              <div className="absolute inset-0 flex items-center opacity-0 group-hover:opacity-100">
                <div className="h-full w-px bg-gray-400 opacity-30" />
              </div>

              {/* Tooltip */}
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 rounded-md bg-gray-800 px-3 py-2 text-xs text-white shadow-lg group-hover:block dark:bg-gray-200 dark:text-gray-900">
                <div className="font-medium">{formatDate(point.date)}</div>
                <div>{point.minutes_read} minutes</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
