package graph

import (
	"testing"
)

func TestGetSVGGraphData(t *testing.T) {
	inputPoints := []int64{10, 90, 50, 5, 10, 5, 70, 60, 50, 90}
	svgData := GetSVGGraphData(inputPoints, 500, 100)

	expect := "M 50,95 C63,95 80,50 100,50 C120,50 128,73 150,73 C172,73 180,98 200,98 C220,98 230,95 250,95 C270,95 279,98 300,98 C321,98 330,62 350,62 C370,62 380,67 400,67 C420,67 430,73 450,73 C470,73 489,50 500,50"
	if svgData.BezierPath != expect {
		t.Fatalf(`Expected: %v, Got: %v`, expect, svgData.BezierPath)
	}

	expect = "L 500,98 L 50,98 Z"
	if svgData.BezierFill != expect {
		t.Fatalf(`Expected: %v, Got: %v`, expect, svgData.BezierFill)
	}

	if svgData.Width != 500 {
		t.Fatalf(`Expected: %v, Got: %v`, 500, svgData.Width)
	}

	if svgData.Height != 100 {
		t.Fatalf(`Expected: %v, Got: %v`, 100, svgData.Height)
	}

	if svgData.Offset != 50 {
		t.Fatalf(`Expected: %v, Got: %v`, 50, svgData.Offset)
	}

}
