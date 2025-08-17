package ui

import (
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
)

// KeyValue is a basic vertical key/value pair component
func KeyValue(key, val g.Node) g.Node {
	return h.Div(
		h.Class("flex flex-col"),
		h.Div(h.Class("text-gray-500"), key),
		h.Div(h.Class("font-medium text-black dark:text-white"), val),
	)
}

// HKeyValue is a basic horizontal key/value pair component
func HKeyValue(key, val g.Node) g.Node {
	return h.Div(
		h.Class("flex gap-2"),
		h.Div(h.Class("text-gray-500"), key),
		h.Div(h.Class("font-medium text-black dark:text-white"), val),
	)
}
