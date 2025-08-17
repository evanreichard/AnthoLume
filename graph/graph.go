package graph

import (
	"fmt"
	"math"
)

type SVGGraphPoint struct {
	X    int
	Y    int
	Size int
}

type SVGGraphData struct {
	Height     int
	Width      int
	Offset     int
	LinePoints []SVGGraphPoint
	BarPoints  []SVGGraphPoint
	BezierPath string
	BezierFill string
}

type SVGBezierOpposedLine struct {
	Length int
	Angle  int
}

func GetSVGGraphData(inputData []int64, svgWidth int, svgHeight int) SVGGraphData {
	// Derive Height
	var maxHeight int
	for _, item := range inputData {
		if int(item) > maxHeight {
			maxHeight = int(item)
		}
	}

	// Vertical Graph Real Estate
	var sizePercentage float32 = 0.5

	// Scale Ratio -> Desired Height
	sizeRatio := float32(svgHeight) * sizePercentage / float32(maxHeight)

	// Point Block Offset
	blockOffset := int(math.Floor(float64(svgWidth) / float64(len(inputData))))

	// Line & Bar Points
	linePoints := []SVGGraphPoint{}
	barPoints := []SVGGraphPoint{}

	// Bezier Fill Coordinates (Max X, Min X, Max Y)
	var maxBX int
	var maxBY int
	var minBX int
	for idx, item := range inputData {
		itemSize := int(float32(item) * sizeRatio)
		itemY := svgHeight - itemSize
		lineX := (idx + 1) * blockOffset
		barPoints = append(barPoints, SVGGraphPoint{
			X:    lineX - (blockOffset / 2),
			Y:    itemY,
			Size: itemSize,
		})

		linePoints = append(linePoints, SVGGraphPoint{
			X:    lineX,
			Y:    itemY,
			Size: itemSize,
		})

		if lineX > maxBX {
			maxBX = lineX
		}

		if lineX < minBX {
			minBX = lineX
		}

		if itemY > maxBY {
			maxBY = itemY
		}
	}

	// Return Data
	return SVGGraphData{
		Width:      svgWidth,
		Height:     svgHeight,
		Offset:     blockOffset,
		LinePoints: linePoints,
		BarPoints:  barPoints,
		BezierPath: getSVGBezierPath(linePoints),
		BezierFill: fmt.Sprintf("L %d,%d L %d,%d Z", maxBX, maxBY, minBX+blockOffset, maxBY),
	}
}

func getSVGBezierOpposedLine(pointA SVGGraphPoint, pointB SVGGraphPoint) SVGBezierOpposedLine {
	lengthX := float64(pointB.X - pointA.X)
	lengthY := float64(pointB.Y - pointA.Y)

	return SVGBezierOpposedLine{
		Length: int(math.Sqrt(lengthX*lengthX + lengthY*lengthY)),
		Angle:  int(math.Atan2(lengthY, lengthX)),
	}
}

func getSVGBezierControlPoint(currentPoint *SVGGraphPoint, prevPoint *SVGGraphPoint, nextPoint *SVGGraphPoint, isReverse bool) SVGGraphPoint {
	// First / Last Point
	if prevPoint == nil {
		prevPoint = currentPoint
	}
	if nextPoint == nil {
		nextPoint = currentPoint
	}

	// Modifiers
	smoothingRatio := 0.2
	var directionModifier float64 = 0
	if isReverse {
		directionModifier = math.Pi
	}

	opposingLine := getSVGBezierOpposedLine(*prevPoint, *nextPoint)
	lineAngle := float64(opposingLine.Angle) + directionModifier
	lineLength := float64(opposingLine.Length) * smoothingRatio

	// Calculate Control Point
	return SVGGraphPoint{
		X: currentPoint.X + int(math.Cos(float64(lineAngle))*lineLength),
		Y: currentPoint.Y + int(math.Sin(float64(lineAngle))*lineLength),
	}
}

func getSVGBezierCurve(point SVGGraphPoint, index int, allPoints []SVGGraphPoint) []SVGGraphPoint {
	var pointMinusTwo *SVGGraphPoint
	var pointMinusOne *SVGGraphPoint
	var pointPlusOne *SVGGraphPoint

	if index-2 >= 0 && index-2 < len(allPoints) {
		pointMinusTwo = &allPoints[index-2]
	}
	if index-1 >= 0 && index-1 < len(allPoints) {
		pointMinusOne = &allPoints[index-1]
	}
	if index+1 >= 0 && index+1 < len(allPoints) {
		pointPlusOne = &allPoints[index+1]
	}

	startControlPoint := getSVGBezierControlPoint(pointMinusOne, pointMinusTwo, &point, false)
	endControlPoint := getSVGBezierControlPoint(&point, pointMinusOne, pointPlusOne, true)

	return []SVGGraphPoint{
		startControlPoint,
		endControlPoint,
		point,
	}
}

func getSVGBezierPath(allPoints []SVGGraphPoint) string {
	var bezierSVGPath string

	for index, point := range allPoints {
		if index == 0 {
			bezierSVGPath += fmt.Sprintf("M %d,%d", point.X, point.Y)
		} else {
			newPoints := getSVGBezierCurve(point, index, allPoints)
			bezierSVGPath += fmt.Sprintf(" C%d,%d %d,%d %d,%d", newPoints[0].X, newPoints[0].Y, newPoints[1].X, newPoints[1].Y, newPoints[2].X, newPoints[2].Y)
		}
	}

	return bezierSVGPath
}
