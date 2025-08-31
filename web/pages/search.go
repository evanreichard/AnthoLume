package pages

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"

	"reichard.io/antholume/pkg/sliceutils"
	"reichard.io/antholume/pkg/utils"
	"reichard.io/antholume/search"
	"reichard.io/antholume/web/assets"
	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
	"reichard.io/antholume/web/pages/layout"
)

var _ Page = (*Search)(nil)

type Search struct {
	Query   string
	Source  search.Source
	Results []models.SearchResult
	Error   string
}

func (p Search) Generate(ctx models.PageContext) (g.Node, error) {
	return layout.Layout(
		ctx.WithRoute(models.SearchPage),
		p.content(),
	)
}

func (p *Search) content() g.Node {
	return h.Div(
		h.Class("flex flex-col gap-4"),
		h.Div(
			h.Class("flex flex-col gap-2 p-4 rounded shadow-lg bg-white dark:bg-gray-700"),
			h.Form(
				h.Class("flex gap-4 flex-col lg:flex-row"),
				h.Action("./search"),
				h.Div(
					h.Class("flex w-full"),
					h.Span(
						h.Class("inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"),
						assets.Icon("search2", 15),
					),
					h.Input(
						h.Type("text"),
						h.ID("query"),
						h.Name("query"),
						h.Value(p.Query),
						h.Class("flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"),
						h.Placeholder("Query"),
					),
				),
				h.Div(
					h.Class("flex relative min-w-[12em]"),
					h.Span(
						h.Class("inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"),
						assets.Icon("documents", 15),
					),
					h.Select(
						h.Class("flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"),
						h.ID("source"),
						h.Name("source"),
						h.Option(
							h.Value("LibGen"),
							g.If(p.Source == search.SourceLibGen, h.Selected()),
							g.Text("Library Genesis"),
						),
						h.Option(
							h.Value("Annas Archive"),
							g.If(p.Source == search.SourceAnnasArchive, h.Selected()),
							g.Text("Annas Archive"),
						),
					),
				),
				h.Div(
					h.Class("lg:w-60"),
					ui.FormButton(
						g.Text("Search"),
						"",
						ui.ButtonConfig{Variant: ui.ButtonVariantSecondary},
					),
				),
			),
			g.If(
				p.Error != "",
				h.Span(h.Class("text-red-400 text-xs"), g.Text(p.Error)),
			),
		),
		h.Div(
			h.Class("inline-block min-w-full overflow-hidden rounded shadow"),
			ui.Table(
				ui.TableConfig{
					Columns: []string{"", "Document", "Series", "Type", "Size", "Date"},
					Rows:    p.tableRows(),
				},
			),
		),
	)
}

func (p *Search) tableRows() []ui.TableRow {
	return sliceutils.Map(p.Results, func(r models.SearchResult) ui.TableRow {
		return ui.TableRow{
			"": ui.TableCell{
				Value: h.Form(
					h.Action("./search"),
					h.Method("POST"),
					h.Input(h.Type("hidden"), h.Name("source"), h.Value(string(p.Source))),
					h.Input(h.Type("hidden"), h.Name("title"), h.Value(r.Title)),
					h.Input(h.Type("hidden"), h.Name("author"), h.Value(r.Author)),
					ui.FormButton(assets.Icon("download", 24), "", ui.ButtonConfig{Variant: ui.ButtonVariantGhost}),
				),
			},
			"Document": ui.TableCell{
				String: fmt.Sprintf("%s - %s", r.Author, r.Title),
			},
			"Series": ui.TableCell{
				String: utils.FirstNonZero(r.Series, "N/A"),
			},
			"Type": ui.TableCell{
				String: utils.FirstNonZero(r.FileType, "N/A"),
			},
			"Size": ui.TableCell{
				String: utils.FirstNonZero(r.FileSize, "N/A"),
			},
			"Date": ui.TableCell{
				String: utils.FirstNonZero(r.UploadDate, "N/A"),
			},
		}
	})
}
