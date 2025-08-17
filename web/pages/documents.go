package pages

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/web/assets"
	"reichard.io/antholume/web/components/document"
	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
)

var _ Page = (*Documents)(nil)

type Documents struct {
	Data     []models.Document
	Previous int
	Next     int
	Limit    int
}

func (Documents) Route() PageRoute { return DocumentsPage }

func (p Documents) Render() g.Node {
	return g.Group([]g.Node{
		searchBar(),
		documentGrid(p.Data),
		pagination(p.Previous, p.Next, p.Limit),
		uploadFAB(),
	})
}

func searchBar() g.Node {
	return h.Div(
		h.Class("flex flex-col gap-2 grow p-4 mb-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"),
		h.Form(
			h.Action("./documents"),
			h.Method("GET"),
			h.Class("flex gap-4 flex-col lg:flex-row"),
			h.Div(
				h.Class("flex flex-col w-full grow"),
				h.Div(
					h.Class("flex relative"),
					h.Span(
						h.Class("inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"),
						assets.Icon("search2", 15),
					),
					h.Input(
						h.Type("text"),
						h.ID("search"),
						h.Name("search"),
						h.Class("flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-2 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"),
						h.Placeholder("Search Author / Title"),
					),
				),
			),
			h.Div(
				h.Class("lg:w-60"),
				ui.FormButton(g.Text("Search"), "", ui.ButtonConfig{Variant: ui.ButtonVariantSecondary}),
			),
		),
	)
}

func documentGrid(docs []models.Document) g.Node {
	return h.Div(
		h.Class("grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"),
		g.Map(docs, func(d models.Document) g.Node { return document.Card(d) }),
	)
}

func pagination(prev, next int, limit int) g.Node {
	link := func(page int, label string) g.Node {
		return h.A(
			h.Href(fmt.Sprintf("./documents?page=%d&limit=%d", page, limit)),
			h.Class("bg-white shadow-lg dark:bg-gray-600 hover:bg-gray-400 font-medium rounded text-sm text-center p-2 w-24 dark:hover:bg-gray-700 focus:outline-none"),
			g.Text(label),
		)
	}
	return h.Div(
		h.Class("w-full flex gap-4 justify-center mt-4 text-black dark:text-white"),
		g.If(prev > 0, link(prev, "◄")),
		g.If(next > 0, link(next, "►")),
	)
}

func uploadFAB() g.Node {
	return h.Div(
		h.Class("fixed bottom-6 right-6 rounded-full flex items-center justify-center"),
		h.Input(h.Type("checkbox"), h.ID("upload-file-button"), h.Class("hidden css-button")),
		h.Div(
			h.Class("absolute right-0 z-10 bottom-0 rounded p-4 bg-gray-800 dark:bg-gray-200 text-white dark:text-black w-72 text-sm flex flex-col gap-2"),
			h.Form(
				h.Method("POST"),
				g.Attr("enctype", "multipart/form-data"),
				h.Action("./documents"),
				h.Class("flex flex-col gap-2"),
				h.Input(
					h.Type("file"),
					h.Accept(".epub"),
					h.ID("document_file"),
					h.Name("document_file"),
				),
				ui.FormButton(g.Text("Upload File"), ""),
			),
			h.Label(
				h.For("upload-file-button"),
				h.Div(
					h.Class("w-full text-center cursor-pointer font-medium mt-2 px-2 py-1 text-gray-800 bg-gray-500 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800"),
					g.Text("Cancel Upload"),
				),
			),
		),
		h.Label(
			h.For("upload-file-button"),
			h.Class("w-16 h-16 bg-gray-800 dark:bg-gray-200 rounded-full flex items-center justify-center opacity-30 hover:opacity-100 transition-all duration-200 cursor-pointer"),
			assets.Icon("upload", 34),
		),
	)
}
