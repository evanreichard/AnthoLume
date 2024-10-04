package common

import (
	"strings"
)

type Route string

var (
	RouteHome        Route = "HOME"
	RouteDocuments   Route = "DOCUMENTS"
	RouteProgress    Route = "PROGRESS"
	RouteActivity    Route = "ACTIVITY"
	RouteSearch      Route = "SEARCH"
	RouteAdmin       Route = "ADMIN"
	RouteAdminImport Route = "ADMIN_IMPORT"
	RouteAdminUsers  Route = "ADMIN_USERS"
	RouteAdminLogs   Route = "ADMIN_LOGS"
)

func (r Route) IsAdmin() bool {
	return strings.HasPrefix("ADMIN", string(r))
}

func (r Route) Name() string {
	var pathSplit []string
	for _, rawPath := range strings.Split(string(r), "_") {
		pathLoc := strings.ToUpper(rawPath[:1]) + strings.ToLower(rawPath[1:])
		pathSplit = append(pathSplit, pathLoc)

	}
	return strings.Join(pathSplit, " - ")
}

type Settings struct {
	Route         Route
	User          string
	Version       string
	IsAdmin       bool
	SearchEnabled bool
}
