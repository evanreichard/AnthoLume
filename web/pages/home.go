package pages

import (
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/database"
	"reichard.io/antholume/web/components/stats"
)

var _ Page = (*Home)(nil)

type Home struct {
	Leaderboard []stats.LeaderboardData
	Streaks     []database.UserStreak
	DailyStats  []database.GetDailyReadStatsRow
	RecordInfo  *database.GetDatabaseInfoRow
}

func (Home) Route() PageRoute { return HomePage }

func (p Home) Render() g.Node {
	return h.Div(
		g.Attr("class", "flex flex-col gap-4"),
		h.Div(
			g.Attr("class", "w-full"),
			h.Div(
				g.Attr("class", "relative w-full bg-white shadow-lg dark:bg-gray-700 rounded"),
				h.P(
					g.Attr("class", "absolute top-3 left-5 text-sm font-semibold border-b border-gray-200 w-max dark:border-gray-500"),
					g.Text("Daily Read Totals"),
				),
				stats.MonthlyChart(p.DailyStats),
			),
		),
		h.Div(
			g.Attr("class", "grid grid-cols-2 gap-4 md:grid-cols-4"),
			stats.InfoCard(stats.InfoCardData{
				Title: "Documents",
				Size:  p.RecordInfo.DocumentsSize,
				Link:  "./documents",
			}),
			stats.InfoCard(stats.InfoCardData{
				Title: "Activity Records",
				Size:  p.RecordInfo.ActivitySize,
				Link:  "./activity",
			}),
			stats.InfoCard(stats.InfoCardData{
				Title: "Progress Records",
				Size:  p.RecordInfo.ProgressSize,
				Link:  "./progress",
			}),
			stats.InfoCard(stats.InfoCardData{
				Title: "Devices",
				Size:  p.RecordInfo.DevicesSize,
			}),
		),
		h.Div(
			g.Attr("class", "grid grid-cols-1 gap-4 md:grid-cols-2"),
			g.Map(p.Streaks, stats.StreakCard),
		),
		h.Div(
			g.Attr("class", "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"),
			g.Map(p.Leaderboard, stats.LeaderboardCard),
		),
	)
}
