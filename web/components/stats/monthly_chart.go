package stats

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/database"
	"reichard.io/antholume/graph"
)

func MonthlyChart(dailyStats []database.GetDailyReadStatsRow) g.Node {
	graphData := buildSVGGraphData(dailyStats, 800, 70)
	return h.Div(
		g.Attr("class", "relative"),
		h.SVG(
			g.Attr("viewBox", fmt.Sprintf("26 0 755 %d", graphData.Height)),
			g.Attr("preserveAspectRatio", "none"),
			g.Attr("width", "100%"),
			g.Attr("height", "6em"),
			g.El("path",
				g.Attr("fill", "#316BBE"),
				g.Attr("fill-opacity", "0.5"),
				g.Attr("stroke", "none"),
				g.Attr("d", graphData.BezierPath+" "+graphData.BezierFill),
			),
			g.El("path",
				g.Attr("fill", "none"),
				g.Attr("stroke", "#316BBE"),
				g.Attr("d", graphData.BezierPath),
			),
		),

		h.Div(
			g.Attr("class", "flex absolute w-full h-full top-0"),
			g.Attr("style", "width: calc(100%*31/30); transform: translateX(-50%); left: 50%"),
			g.Group(g.Map(dailyStats, func(d database.GetDailyReadStatsRow) g.Node {
				return h.Div(
					g.Attr("onclick", ""),
					g.Attr("class", "opacity-0 hover:opacity-100 w-full"),
					g.Attr("style", "background: linear-gradient(rgba(128, 128, 128, 0.5), rgba(128, 128, 128, 0.5)) no-repeat center/2px 100%"),
					h.Div(
						g.Attr("class", "flex flex-col items-center p-2 rounded absolute top-3 dark:text-white text-xs pointer-events-none"),
						g.Attr("style", "transform: translateX(-50%); background-color: rgba(128, 128, 128, 0.2); left: 50%"),
						h.Span(g.Text(d.Date)),
						h.Span(g.Textf("%d minutes", d.MinutesRead)),
					),
				)
			})),
		),
	)
}

// buildSVGGraphData builds SVGGraphData from the provided stats, width and height.
func buildSVGGraphData(inputData []database.GetDailyReadStatsRow, svgWidth int, svgHeight int) graph.SVGGraphData {
	var intData []int64
	for _, item := range inputData {
		intData = append(intData, item.MinutesRead)
	}
	return graph.GetSVGGraphData(intData, svgWidth, svgHeight)
}
