package ui

import (
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/pkg/sliceutils"
	"reichard.io/antholume/web/models"
)

func Notifications(notifications []*models.Notification) g.Node {
	if len(notifications) == 0 {
		return nil
	}
	return h.Div(
		h.Class("fixed flex flex-col gap-2 bottom-0 right-0 p-2 sm:p-4 text-white dark:text-black"),
		g.Group(sliceutils.Map(notifications, notificationNode)),
	)
}

func notificationNode(n *models.Notification) g.Node {
	return h.Div(
		h.Class("bg-gray-600 dark:bg-gray-400 px-4 py-2 rounded-lg shadow-lg w-64 animate-notification"),
		h.P(g.Text(n.Content)),
	)
}
