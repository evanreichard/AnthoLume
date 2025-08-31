package layout

type Route string

const (
	HomePage         Route = "home"
	DocumentPage     Route = "document"
	DocumentsPage    Route = "documents"
	ProgressPage     Route = "progress"
	ActivityPage     Route = "activity"
	SearchPage       Route = "search"
	SettingsPage     Route = "settings"
	AdminGeneralPage Route = "admin-general"
	AdminImportPage  Route = "admin-import"
	AdminUsersPage   Route = "admin-users"
	AdminLogsPage    Route = "admin-logs"
)

var pageTitleMap = map[Route]string{
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

func (p Route) Title() string {
	return pageTitleMap[p]
}
