package pages

import (
	"fmt"
	"time"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/pkg/formatters"
	"reichard.io/antholume/pkg/ptr"
	"reichard.io/antholume/pkg/utils"
	"reichard.io/antholume/web/assets"
	"reichard.io/antholume/web/components/document"
	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
	"reichard.io/antholume/web/pages/layout"
)

var _ Page = (*Document)(nil)

type Document struct {
	Data   models.Document
	Search *models.DocumentMetadata
}

func (p *Document) Generate(ctx models.PageContext) (g.Node, error) {
	return layout.Layout(
		ctx.WithRoute(models.DocumentPage),
		p.content(),
	)
}

func (p *Document) content() g.Node {
	return h.Div(
		h.Class("h-full w-full overflow-scroll bg-white shadow-lg dark:bg-gray-700 rounded dark:text-white p-4"),
		document.Actions(p.Data),

		// Details
		h.Div(
			h.Class("grid sm:grid-cols-2 justify-between gap-3 pb-3"),

			editableKeyValue(
				p.Data.ID,
				"Title",
				p.Data.Title,
				"title",
			),
			editableKeyValue(
				p.Data.ID,
				"Author",
				p.Data.Author,
				"author",
			),
			popoverKeyValue(
				"Time Read",
				formatters.FormatDuration(p.Data.TotalTimeRead),
				"info",
				p.detailsPopover(),
			),

			ui.KeyValue(
				g.Text("Progress"),
				g.Text(fmt.Sprintf("%.2f%%", p.Data.Percentage)),
			),
			ui.KeyValue(
				g.Text("ISBN-10"),
				g.Text(utils.FirstNonZero(p.Data.ISBN10, "N/A")),
			),
			ui.KeyValue(
				g.Text("ISBN-13"),
				g.Text(utils.FirstNonZero(p.Data.ISBN13, "N/A")),
			),
		),

		editableKeyValue(
			p.Data.ID,
			"Description",
			p.Data.Description,
			"description",
			ui.PopoverConfig{Classes: "w-full"},
		),

		document.IdentifyPopover(p.Data.ID, p.Search),
	)
}

func (p *Document) detailsPopover() g.Node {
	totalTimeLeft := time.Duration((100.0 - p.Data.Percentage) * float64(p.Data.TimePerPercent))
	percentPerHour := 1.0 / p.Data.TimePerPercent.Hours()
	return h.Div(
		statKV("WPM", fmt.Sprint(p.Data.WPM)),
		statKV("Words", formatters.FormatNumber(ptr.Deref(p.Data.Words))),
		statKV("Hourly Rate", fmt.Sprintf("%.1f%%", percentPerHour)),
		statKV("Time Remaining", formatters.FormatDuration(totalTimeLeft)),
	)
}

func popoverKeyValue(title, value, icon string, popover g.Node, popoverCfg ...ui.PopoverConfig) g.Node {
	return ui.KeyValue(
		ui.AnchoredPopover(
			h.Div(
				h.Class("inline-flex gap-2 items-center"),
				h.P(g.Text(title)),
				ui.SpanButton(assets.Icon(icon, 18), ui.ButtonConfig{Variant: ui.ButtonVariantGhost}),
			),
			popover,
			popoverCfg...,
		),
		g.Text(value),
	)
}

func editableKeyValue(id, title, currentValue, formKey string, popoverCfg ...ui.PopoverConfig) g.Node {
	currentValue = utils.FirstNonZero(currentValue, "N/A")
	editPopover := h.Form(
		h.Class("flex flex-col gap-2"),
		h.Action(fmt.Sprintf("./%s/edit", id)),
		h.Method("POST"),
		h.Textarea(
			h.ID(formKey),
			h.Name(formKey),
			h.Class("p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white"),
			g.Text(currentValue),
		),
		ui.FormButton(g.Text("Save"), ""),
	)
	return popoverKeyValue(title, currentValue, "edit", editPopover, popoverCfg...)
}

func statKV(title, val string) g.Node {
	return ui.HKeyValue(
		h.P(h.Class("text-xs w-24 text-gray-400"), g.Text(title)),
		h.P(h.Class("text-xs text-nowrap"), g.Text(val)),
	)
}
