package layout

import (
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/web/pages"
)

type LayoutOptions struct {
	SearchEnabled bool
	IsAdmin       bool
	Username      string
	Version       string
}

func Layout(p pages.Page, opts LayoutOptions) g.Node {
	return h.Doctype(
		h.HTML(
			g.Attr("lang", "en"),
			Head(p.Route().Title()),
			h.Body(
				g.Attr("class", "bg-gray-100 dark:bg-gray-800 text-black dark:text-white"),
				Navigation(p.Route(), &opts),
				Base(p.Render()),
			),
		),
	)
}

func Head(routeTitle string) g.Node {
	return h.Head(
		h.Title("AnthoLume - "+routeTitle),
		h.Meta(g.Attr("charset", "utf-8")),
		h.Meta(g.Attr("name", "viewport"), g.Attr("content", "width=device-width, initial-scale=0.9, user-scalable=no, viewport-fit=cover")),
		h.Meta(g.Attr("name", "apple-mobile-web-app-capable"), g.Attr("content", "yes")),
		h.Meta(g.Attr("name", "apple-mobile-web-app-status-bar-style"), g.Attr("content", "black-translucent")),
		h.Meta(g.Attr("name", "theme-color"), g.Attr("content", "#F3F4F6"), g.Attr("media", "(prefers-color-scheme: light)")),
		h.Meta(g.Attr("name", "theme-color"), g.Attr("content", "#1F2937"), g.Attr("media", "(prefers-color-scheme: dark)")),
		h.Link(g.Attr("rel", "manifest"), g.Attr("href", "/manifest.json")),
		h.Link(g.Attr("rel", "stylesheet"), g.Attr("href", "/assets/index.css")),
		h.Link(g.Attr("rel", "stylesheet"), g.Attr("href", "/assets/tailwind.css")),
		h.Script(g.Attr("src", "/assets/lib/idb-keyval.min.js")),
		h.Script(g.Attr("src", "/assets/common.js")),
		h.Script(g.Attr("src", "/assets/index.js")),
	)
}

func Base(body g.Node) g.Node {
	return h.Main(
		g.Attr("class", "relative overflow-hidden"),
		h.Div(
			g.Attr("id", "container"),
			g.Attr("class", "h-[100dvh] px-4 overflow-auto md:px-6 lg:ml-48"),
			body,
		),
	)
}
