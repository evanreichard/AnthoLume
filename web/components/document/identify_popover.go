package document

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/pkg/utils"
	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
)

func IdentifyPopover(docID string, m *models.DocumentMetadata) g.Node {
	if m == nil {
		return nil
	}

	if m.Error != nil {
		return ui.Popover(h.Div(
			h.Class("flex flex-col gap-2"),
			h.H3(
				h.Class("text-lg font-bold text-center"),
				g.Text("Error"),
			),
			h.Div(
				h.Class("bg-gray-100 dark:bg-gray-900 p-2"),
				h.P(g.Text(*m.Error)),
			),
			ui.LinkButton(g.Text("Back to Document"), fmt.Sprintf("/documents/%s", docID)),
		))
	}

	return ui.Popover(h.Div(
		h.Class("flex flex-col gap-2"),
		h.H3(
			h.Class("text-lg font-bold text-center"),
			g.Text("Metadata Results"),
		),
		h.Form(
			h.ID("metadata-save"),
			h.Method("POST"),
			h.Action(fmt.Sprintf("/documents/%s/edit", docID)),
			h.Class("text-black dark:text-white border-b dark:border-black"),
			h.Dl(
				h.Div(
					h.Class("p-3 bg-gray-100 dark:bg-gray-900 grid grid-cols-3 gap-4 sm:px-6"),
					h.Dt(h.Class("my-auto font-medium text-gray-500"), g.Text("Cover")),
					h.Dd(
						h.Class("mt-1 text-sm sm:mt-0 sm:col-span-2"),
						h.Img(
							h.Class("rounded object-fill h-32"),
							h.Src(fmt.Sprintf("https://books.google.com/books/content/images/frontcover/%s?fife=w480-h690", m.SourceID)),
						),
					),
				),
				h.Div(
					h.Class("p-3 bg-white dark:bg-gray-800 grid grid-cols-3 gap-4 sm:px-6"),
					h.Dt(h.Class("my-auto font-medium text-gray-500"), g.Text("Title")),
					h.Dd(h.Class("mt-1 text-sm sm:mt-0 sm:col-span-2"), g.Text(utils.FirstNonZero(m.Title, "N/A"))),
				),
				h.Div(
					h.Class("p-3 bg-gray-100 dark:bg-gray-900 grid grid-cols-3 gap-4 sm:px-6"),
					h.Dt(h.Class("my-auto font-medium text-gray-500"), g.Text("Author")),
					h.Dd(h.Class("mt-1 text-sm sm:mt-0 sm:col-span-2"), g.Text(utils.FirstNonZero(m.Author, "N/A"))),
				),
				h.Div(
					h.Class("p-3 bg-white dark:bg-gray-800 grid grid-cols-3 gap-4 sm:px-6"),
					h.Dt(h.Class("my-auto font-medium text-gray-500"), g.Text("ISBN 10")),
					h.Dd(h.Class("mt-1 text-sm sm:mt-0 sm:col-span-2"), g.Text(utils.FirstNonZero(m.ISBN10, "N/A"))),
				),
				h.Div(
					h.Class("p-3 bg-gray-100 dark:bg-gray-900 grid grid-cols-3 gap-4 sm:px-6"),
					h.Dt(h.Class("my-auto font-medium text-gray-500"), g.Text("ISBN 13")),
					h.Dd(h.Class("mt-1 text-sm sm:mt-0 sm:col-span-2"), g.Text(utils.FirstNonZero(m.ISBN13, "N/A"))),
				),
				h.Div(
					h.Class("p-3 bg-white dark:bg-gray-800 sm:grid sm:grid-cols-3 sm:gap-4 px-6"),
					h.Dt(h.Class("my-auto font-medium text-gray-500"), g.Text("Description")),
					h.Dd(
						h.Class("max-h-[10em] overflow-scroll mt-1 sm:mt-0 sm:col-span-2"),
						g.Text(utils.FirstNonZero(m.Description, "N/A")),
					),
				),
			),
			h.Div(
				h.Class("hidden"),
				h.Input(h.Type("text"), h.ID("title"), h.Name("title"), h.Value(m.Title)),
				h.Input(h.Type("text"), h.ID("author"), h.Name("author"), h.Value(m.Author)),
				h.Input(h.Type("text"), h.ID("description"), h.Name("description"), h.Value(m.Description)),
				h.Input(h.Type("text"), h.ID("isbn_10"), h.Name("isbn_10"), h.Value(m.ISBN10)),
				h.Input(h.Type("text"), h.ID("isbn_13"), h.Name("isbn_13"), h.Value(m.ISBN13)),
				h.Input(h.Type("text"), h.ID("cover_gbid"), h.Name("cover_gbid"), h.Value(m.SourceID)),
			),
		),
		h.Div(
			h.Class("flex justify-end"),
			h.Div(
				h.Class("flex gap-4 w-48"),
				ui.LinkButton(g.Text("Cancel"), fmt.Sprintf("/documents/%s", docID)),
				ui.FormButton(g.Text("Save"), "metadata-save"),
			),
		),
	))
}
