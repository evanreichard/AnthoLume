package stats

import (
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/database"
)

func StreakCard(s database.UserStreak) g.Node {
	return h.Div(
		g.Attr("class", "w-full"),
		h.Div(
			g.Attr("class", "relative w-full px-4 py-6 bg-white shadow-lg dark:bg-gray-700 rounded"),
			h.P(
				g.Attr("class", "text-sm font-semibold text-gray-700 border-b border-gray-200 w-max dark:text-white dark:border-gray-500"),
				g.If(s.Window == "WEEK", g.Text("Weekly Read Streak")),
				g.If(s.Window != "WEEK", g.Text("Daily Read Streak")),
			),
			h.Div(
				g.Attr("class", "flex items-end my-6 space-x-2"),
				h.P(
					g.Attr("class", "text-5xl font-bold text-black dark:text-white"),
					g.Textf("%d", s.CurrentStreak),
				),
			),
			h.Div(
				g.Attr("class", "dark:text-white"),
				h.Div(
					g.Attr("class", "flex items-center justify-between pb-2 mb-2 text-sm border-b border-gray-200"),
					h.Div(
						h.P(
							g.If(s.Window == "WEEK", g.Text("Current Weekly Streak")),
							g.If(s.Window != "WEEK", g.Text("Current Daily Streak")),
						),
						h.Div(
							g.Attr("class", "flex items-end text-sm text-gray-400"),
							g.Textf("%s ➞ %s", s.CurrentStreakStartDate, s.CurrentStreakEndDate),
						),
					),
					h.Div(
						g.Attr("class", "flex items-end font-bold"),
						g.Textf("%d", s.CurrentStreak),
					),
				),
				h.Div(
					g.Attr("class", "flex items-center justify-between pb-2 mb-2 text-sm"),
					h.Div(
						h.P(
							g.If(s.Window == "WEEK", g.Text("Best Weekly Streak")),
							g.If(s.Window != "WEEK", g.Text("Best Daily Streak")),
						),
						h.Div(
							g.Attr("class", "flex items-end text-sm text-gray-400"),
							g.Textf("%s ➞ %s", s.MaxStreakStartDate, s.MaxStreakEndDate),
						),
					),
					h.Div(
						g.Attr("class", "flex items-end font-bold"),
						g.Textf("%d", s.MaxStreak),
					),
				),
			),
		),
	)
}
