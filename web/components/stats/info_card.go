package stats

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
)

type InfoCardData struct {
	Title string
	Size  int64
	Link  string
}

func InfoCard(d InfoCardData) g.Node {
	cardContent := h.Div(
		g.Attr("class", "flex gap-4 w-full p-4 bg-white shadow-lg dark:bg-gray-700 rounded"),
		h.Div(
			g.Attr("class", "flex flex-col justify-around w-full text-sm"),
			h.P(g.Attr("class", "text-2xl font-bold"), g.Text(fmt.Sprint(d.Size))),
			h.P(g.Attr("class", "text-sm text-gray-400"), g.Text(d.Title)),
		),
	)

	if d.Link == "" {
		return h.Div(g.Attr("class", "w-full"), cardContent)
	}

	return h.A(
		g.Attr("class", "w-full"),
		h.Href(d.Link),
		cardContent,
	)
}
