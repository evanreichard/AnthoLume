package forms

import (
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/web/components/ui"
)

func Edit(key, val, url string) g.Node {
	return h.Form(
		h.Class("flex flex-col gap-2 text-black dark:text-white text-sm"),
		h.Method("POST"),
		h.Action(url),
		h.Input(
			h.Class("p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white"),
			h.Type("text"),
			h.ID(key),
			h.Name(key),
			h.Value(val),
		),
		ui.FormButton(g.Text("Save"), ""),
	)
}
