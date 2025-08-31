package models

type PageContext struct {
	Route         PageRoute
	UserInfo      *UserInfo
	ServerInfo    *ServerInfo
	Notifications []*Notification
}

func (ctx PageContext) WithRoute(route PageRoute) PageContext {
	ctx.Route = route
	return ctx
}

type PageRoute string

const (
	HomePage         PageRoute = "home"
	DocumentPage     PageRoute = "document"
	DocumentsPage    PageRoute = "documents"
	ProgressPage     PageRoute = "progress"
	ActivityPage     PageRoute = "activity"
	SearchPage       PageRoute = "search"
	SettingsPage     PageRoute = "settings"
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
	SettingsPage:     "Settings",
	AdminGeneralPage: "Admin - General",
	AdminImportPage:  "Admin - Import",
	AdminUsersPage:   "Admin - Users",
	AdminLogsPage:    "Admin - Logs",
}

func (p PageRoute) Title() string {
	return pageTitleMap[p]
}

func (p PageRoute) Valid() bool {
	_, ok := pageTitleMap[p]
	return ok
}
