package document

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/pkg/formatters"
	"reichard.io/antholume/web/assets"
	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
)

func Card(d models.Document) g.Node {
	return h.Div(
		h.Class("w-full relative"),
		h.Div(
			h.Class("flex gap-4 w-full h-full p-4 shadow-lg bg-white dark:bg-gray-700 rounded"),
			h.Div(
				h.Class("min-w-fit my-auto h-48 relative"),
				h.A(
					h.Href("./documents/"+d.ID),
					h.Img(
						h.Src("./documents/"+d.ID+"/cover"),
						h.Class("rounded object-cover h-full"),
					),
				),
			),
			h.Div(
				h.Class("flex flex-col justify-around dark:text-white w-full text-sm"),
				ui.KeyValue(g.Text("Title"), g.Text(d.Title)),
				ui.KeyValue(g.Text("Author"), g.Text(d.Author)),
				ui.KeyValue(g.Text("Progress"), g.Text(fmt.Sprintf("%.2f%%", d.Percentage))),
				ui.KeyValue(g.Text("Time Read"), g.Text(formatters.FormatDuration(d.TotalTimeRead))),
			),
		),
		h.Div(
			h.Class("absolute flex flex-col gap-2 right-4 bottom-4 text-gray-500 dark:text-gray-400"),
			ui.LinkButton(
				assets.Icon("activity", 24),
				"./activity?document="+d.ID,
				ui.ButtonConfig{Variant: ui.ButtonVariantGhost},
			),
			ui.LinkButton(
				assets.Icon("download", 24),
				"./documents/"+d.ID+"/file",
				ui.ButtonConfig{
					Variant:  ui.ButtonVariantGhost,
					Disabled: !d.HasFile,
				},
			),
		),
	)
}
