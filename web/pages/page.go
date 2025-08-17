package pages

import (
	g "maragu.dev/gomponents"
)

type PageRoute string

const (
	HomePage         PageRoute = "home"
	DocumentPage     PageRoute = "document"
	DocumentsPage    PageRoute = "documents"
	ProgressPage     PageRoute = "progress"
	ActivityPage     PageRoute = "activity"
	SearchPage       PageRoute = "search"
	AdminGeneralPage PageRoute = "admin-general"
	AdminImportPage  PageRoute = "admin-import"
	AdminUsersPage   PageRoute = "admin-users"
	AdminLogsPage    PageRoute = "admin-logs"
)

var pageTitleMap = map[PageRoute]string{
	HomePage:         "Home",
	DocumentPage:     "Document",
	DocumentsPage:    "Documents",
	ProgressPage:     "Progress",
	ActivityPage:     "Activity",
	SearchPage:       "Search",
	AdminGeneralPage: "Admin - General",
	AdminImportPage:  "Admin - Import",
	AdminUsersPage:   "Admin - Users",
	AdminLogsPage:    "Admin - Logs",
}

func (p PageRoute) Title() string {
	return pageTitleMap[p]
}

type Page interface {
	Route() PageRoute
	Render() g.Node
}
