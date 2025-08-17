package stats

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
)

type LeaderboardItem struct {
	UserID string
	Value  string
}

type LeaderboardData struct {
	Name  string
	All   []LeaderboardItem
	Year  []LeaderboardItem
	Month []LeaderboardItem
	Week  []LeaderboardItem
}

func LeaderboardCard(l LeaderboardData) g.Node {
	orderedItems := map[string][]LeaderboardItem{
		"All":   l.All,
		"Year":  l.Year,
		"Month": l.Month,
		"Week":  l.Week,
	}

	var allNodes []g.Node
	for key, items := range orderedItems {
		// Get Top Reader Nodes
		topReaders := items[:min(len(items), 3)]
		var topReaderNodes []g.Node
		for idx, reader := range topReaders {
			border := ""
			if idx > 0 {
				border = " border-t border-gray-200"
			}
			topReaderNodes = append(topReaderNodes, h.Div(
				g.Attr("class", "flex items-center justify-between pt-2 pb-2 text-sm"+border),
				h.Div(h.P(g.Text(reader.UserID))),
				h.Div(g.Attr("class", "flex items-end font-bold"), g.Text(reader.Value)),
			))
		}

		allNodes = append(allNodes, g.Group([]g.Node{
			h.Div(
				g.Attr("class", "flex items-end my-6 space-x-2 hidden peer-checked/"+key+":block"),
				g.If(len(items) == 0,
					h.P(g.Attr("class", "text-5xl font-bold text-black dark:text-white"), g.Text("N/A")),
				),
				g.If(len(items) > 0,
					h.P(g.Attr("class", "text-5xl font-bold text-black dark:text-white"), g.Text(items[0].UserID)),
				),
			),
			h.Div(
				g.Attr("class", "hidden dark:text-white peer-checked/"+key+":block"),
				g.Group(topReaderNodes),
			),
		}))
	}

	return h.Div(
		g.Attr("class", "w-full"),
		h.Div(
			g.Attr("class", "flex flex-col justify-between h-full w-full px-4 py-6 bg-white shadow-lg dark:bg-gray-700 rounded"),
			h.Div(
				h.Div(
					g.Attr("class", "flex justify-between"),
					h.P(
						g.Attr("class", "text-sm font-semibold text-gray-700 border-b border-gray-200 w-max dark:text-white dark:border-gray-500"),
						g.Textf("%s Leaderboard", l.Name),
					),
					h.Div(
						g.Attr("class", "flex gap-2 text-xs text-gray-400 items-center"),
						h.Label(
							g.Attr("for", fmt.Sprintf("all-%s", l.Name)),
							g.Attr("class", "cursor-pointer hover:text-black dark:hover:text-white"),
							g.Text("all"),
						),
						h.Label(
							g.Attr("for", fmt.Sprintf("year-%s", l.Name)),
							g.Attr("class", "cursor-pointer hover:text-black dark:hover:text-white"),
							g.Text("year"),
						),
						h.Label(
							g.Attr("for", fmt.Sprintf("month-%s", l.Name)),
							g.Attr("class", "cursor-pointer hover:text-black dark:hover:text-white"),
							g.Text("month"),
						),
						h.Label(
							g.Attr("for", fmt.Sprintf("week-%s", l.Name)),
							g.Attr("class", "cursor-pointer hover:text-black dark:hover:text-white"),
							g.Text("week"),
						),
					),
				),
			),

			h.Input(
				g.Attr("type", "radio"),
				g.Attr("name", fmt.Sprintf("options-%s", l.Name)),
				g.Attr("id", fmt.Sprintf("all-%s", l.Name)),
				g.Attr("class", "hidden peer/All"),
				g.Attr("checked", ""),
			),
			h.Input(
				g.Attr("type", "radio"),
				g.Attr("name", fmt.Sprintf("options-%s", l.Name)),
				g.Attr("id", fmt.Sprintf("year-%s", l.Name)),
				g.Attr("class", "hidden peer/Year"),
			),
			h.Input(
				g.Attr("type", "radio"),
				g.Attr("name", fmt.Sprintf("options-%s", l.Name)),
				g.Attr("id", fmt.Sprintf("month-%s", l.Name)),
				g.Attr("class", "hidden peer/Month"),
			),
			h.Input(
				g.Attr("type", "radio"),
				g.Attr("name", fmt.Sprintf("options-%s", l.Name)),
				g.Attr("id", fmt.Sprintf("week-%s", l.Name)),
				g.Attr("class", "hidden peer/Week"),
			),
			g.Group(allNodes),
		),
	)
}
