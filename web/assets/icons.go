package assets

import (
	"strconv"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
)

func Icon(name string, size int) g.Node {
	return h.SVG(
		g.Attr("width", strconv.Itoa(size)),
		g.Attr("height", strconv.Itoa(size)),
		g.Attr("viewBox", "0 0 24 24"),
		g.Attr("fill", "currentColor"),
		Asset("svgs/"+name+".svg"),
	)
}
