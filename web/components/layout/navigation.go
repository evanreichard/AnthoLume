package layout

import (
	"strings"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/web/assets"
	"reichard.io/antholume/web/pages"
)

const (
	active   = "border-purple-500 dark:text-white"
	inactive = "border-transparent text-gray-400 hover:text-gray-800 dark:hover:text-gray-100"
)

func Navigation(currentRoute pages.PageRoute, opts *LayoutOptions) g.Node {
	return h.Div(
		g.Attr("class", "flex items-center justify-between w-full h-16"),
		Sidebar(currentRoute, opts),
		h.H1(g.Attr("class", "text-xl font-bold px-6 lg:ml-44"), g.Text(currentRoute.Title())),
		Dropdown(opts.Username),
	)
}

func Sidebar(currentRoute pages.PageRoute, opts *LayoutOptions) g.Node {
	links := []g.Node{
		navLink(currentRoute, pages.HomePage, "/", "home"),
		navLink(currentRoute, pages.DocumentsPage, "/documents", "documents"),
		navLink(currentRoute, pages.ProgressPage, "/progress", "activity"),
		navLink(currentRoute, pages.ActivityPage, "/activity", "activity"),
	}
	if opts.SearchEnabled {
		links = append(links, navLink(currentRoute, pages.SearchPage, "/search", "search"))
	}
	if opts.IsAdmin {
		links = append(links, adminLinks(currentRoute))
	}

	return h.Div(
		g.Attr("id", "mobile-nav-button"),
		g.Attr("class", "flex flex-col z-40 relative ml-6"),
		hamburgerIcon(),
		h.Div(
			g.Attr("id", "menu"),
			g.Attr("class", "fixed -ml-6 h-full w-56 lg:w-48 bg-white dark:bg-gray-700 shadow-lg"),
			h.Div(
				g.Attr("class", "h-16 flex justify-end lg:justify-around"),
				h.P(g.Attr("class", "text-xl font-bold text-right my-auto pr-8 lg:pr-0"), g.Text("AnthoLume")),
			),
			h.Div(links...),
			h.A(
				g.Attr("href", "https://gitea.va.reichard.io/evan/AnthoLume"),
				g.Attr("target", "_blank"),
				g.Attr("class", "flex flex-col gap-2 justify-center items-center p-6 w-full absolute bottom-0 text-black dark:text-white"),
				assets.Icon("gitea", 20),
				h.Span(g.Attr("class", "text-xs"), g.Text(opts.Version)),
			),
		),
	)
}

func navLink(currentRoute, linkRoute pages.PageRoute, path, icon string) g.Node {
	class := inactive
	if currentRoute == linkRoute {
		class = active
	}
	return h.A(
		g.Attr("class", "flex items-center justify-start w-full p-2 pl-6 my-2 transition-colors duration-200 border-l-4 "+class),
		h.Href(path),
		assets.Icon(icon, 20),
		h.Span(g.Attr("class", "mx-4 text-sm font-normal"), g.Text(linkRoute.Title())),
	)
}

func adminLinks(currentRoute pages.PageRoute) g.Node {
	routeID := string(currentRoute)

	class := inactive
	if strings.HasPrefix(routeID, "admin") {
		class = active
	}

	children := g.If(strings.HasPrefix(routeID, "admin"),
		g.Group([]g.Node{
			subNavLink(currentRoute, pages.AdminGeneralPage, "/admin"),
			subNavLink(currentRoute, pages.AdminImportPage, "/admin/import"),
			subNavLink(currentRoute, pages.AdminUsersPage, "/admin/users"),
			subNavLink(currentRoute, pages.AdminLogsPage, "/admin/logs"),
		}),
	)

	return h.Div(
		g.Attr("class", "flex flex-col gap-4 p-2 pl-6 my-2 transition-colors duration-200 border-l-4 "+class),
		h.A(
			g.Attr("href", "/admin"),
			g.Attr("class", "flex justify-start w-full"),
			assets.Icon("settings", 20),
			h.Span(g.Attr("class", "mx-4 text-sm font-normal"), g.Text("Admin")),
		),
		children,
	)
}

func subNavLink(currentRoute, linkRoute pages.PageRoute, path string) g.Node {
	class := inactive
	if currentRoute == linkRoute {
		class = active
	}

	pageTitle := linkRoute.Title()
	if splitString := strings.Split(pageTitle, " - "); len(splitString) > 1 {
		pageTitle = splitString[1]
	}

	return h.A(
		g.Attr("class", class),
		g.Attr("href", path),
		g.Attr("style", "padding-left:1.75em"),
		h.Span(g.Attr("class", "mx-4 text-sm font-normal"), g.Text(pageTitle)),
	)
}

func hamburgerIcon() g.Node {
	return g.Group([]g.Node{
		h.Input(g.Attr("type", "checkbox"), g.Attr("class", "absolute lg:hidden z-50 -top-2 w-7 h-7 opacity-0 cursor-pointer")),
		h.Span(g.Attr("class", "lg:hidden bg-black dark:bg-white w-7 h-0.5 z-40 mt-0.5")),
		h.Span(g.Attr("class", "lg:hidden bg-black dark:bg-white w-7 h-0.5 z-40 mt-1")),
		h.Span(g.Attr("class", "lg:hidden bg-black dark:bg-white w-7 h-0.5 z-40 mt-1")),
	})
}

func Dropdown(username string) g.Node {
	return h.Div(
		g.Attr("class", "relative flex items-center justify-end w-full p-4"),
		h.Input(g.Attr("type", "checkbox"), g.Attr("id", "user-dropdown-button"), g.Attr("class", "hidden")),
		h.Div(
			g.Attr("id", "user-dropdown"),
			g.Attr("class", "transition duration-200 z-20 absolute right-4 top-16 pt-4"),
			h.Div(
				g.Attr("class", "w-40 origin-top-right bg-white rounded-md shadow-lg dark:shadow-gray-800 dark:bg-gray-700 ring-1 ring-black ring-opacity-5"),
				h.Div(
					g.Attr("class", "py-1"),
					dropdownItem("/settings", "Settings"),
					dropdownItem("/local", "Offline"),
					dropdownItem("/logout", "Logout"),
				),
			),
		),
		h.Label(
			g.Attr("for", "user-dropdown-button"),
			h.Div(
				g.Attr("class", "flex items-center gap-2 text-md py-4 cursor-pointer"),
				assets.Icon("user", 20),
				h.Span(g.Text(username)),
				assets.Icon("dropdown", 20),
			),
		),
	)
}

func dropdownItem(href, text string) g.Node {
	return h.A(
		g.Attr("href", href),
		g.Attr("class", "block px-4 py-2 text-md text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:text-white dark:hover:bg-gray-600"),
		g.Text(text),
	)
}
