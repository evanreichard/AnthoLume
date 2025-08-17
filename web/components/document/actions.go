package document

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"

	"reichard.io/antholume/pkg/utils"
	"reichard.io/antholume/web/assets"
	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
)

func Actions(d models.Document) g.Node {
	return h.Div(
		h.Class("flex flex-col float-left gap-2 w-44 md:w-60 lg:w-80 mr-4 relative"),

		// Cover
		ui.AnchoredPopover(
			h.Img(
				h.Class("rounded object-fill w-full"),
				h.Src(fmt.Sprintf("/documents/%s/cover", d.ID)),
			),
			editCoverPopover(d.ID),
		),

		// Read
		ui.LinkButton(g.Text("Read"), fmt.Sprintf("/reader#id=%s&type=REMOTE", d.ID)),

		// Actions
		h.Div(
			h.Class("flex flex-col justify-between z-20 gap-2 relative"),

			h.Div(
				h.Class("flex grow align-center justify-between my-auto text-gray-500 dark:text-gray-500"),

				ui.AnchoredPopover(
					ui.SpanButton(assets.Icon("delete", 28), ui.ButtonConfig{Variant: ui.ButtonVariantGhost}),
					deletePopover(d.ID),
				),

				ui.LinkButton(
					assets.Icon("activity", 28),
					fmt.Sprintf("../activity?document=%s", d.ID),
					ui.ButtonConfig{Variant: ui.ButtonVariantGhost},
				),

				ui.AnchoredPopover(
					ui.SpanButton(assets.Icon("search", 28), ui.ButtonConfig{Variant: ui.ButtonVariantGhost}),
					searchPopover(d),
				),

				ui.LinkButton(
					assets.Icon("download", 28),
					fmt.Sprintf("./%s/file", d.ID),
					ui.ButtonConfig{
						Variant:  ui.ButtonVariantGhost,
						Disabled: !d.HasFile,
					},
				),
			),
		),
	)
}

func editCoverPopover(docID string) g.Node {
	return h.Div(
		h.Class("flex flex-col gap-2"),
		h.Form(
			h.Class("flex flex-col gap-2 w-[19rem] text-black dark:text-white text-sm"),
			h.Method("POST"),
			g.Attr("enctype", "multipart/form-data"),
			h.Action(fmt.Sprintf("./%s/edit", docID)),
			h.Input(h.Type("file"), h.ID("cover_file"), h.Name("cover_file")),
			ui.FormButton(g.Text("Upload Cover"), ""),
		),
		h.Form(
			h.Class("flex flex-col gap-2 w-[19rem] text-black dark:text-white text-sm"),
			h.Method("POST"),
			h.Action(fmt.Sprintf("./%s/edit", docID)),
			h.Input(
				h.ID("remove_cover"),
				h.Name("remove_cover"),
				h.Class("hidden"),
				h.Type("checkbox"),
				h.Checked(),
			),
			ui.FormButton(g.Text("Remove Cover"), ""),
		),
	)
}

func deletePopover(id string) g.Node {
	return h.Form(
		h.Class("text-black dark:text-white text-sm w-24"),
		h.Method("POST"),
		h.Action(fmt.Sprintf("./%s/delete", id)),
		ui.FormButton(g.Text("Delete"), ""),
	)
}

func searchPopover(d models.Document) g.Node {
	return h.Form(
		h.Method("POST"),
		h.Action(fmt.Sprintf("./%s/identify", d.ID)),
		h.Class("flex flex-col gap-2 text-black dark:text-white text-sm"),
		h.Input(
			h.ID("title"),
			h.Name("title"),
			h.Class("p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white"),
			h.Type("text"),
			h.Placeholder("Title"),
			h.Value(d.Title),
		),
		h.Input(
			h.ID("author"),
			h.Name("author"),
			h.Class("p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white"),
			h.Type("text"),
			h.Placeholder("Author"),
			h.Value(d.Author),
		),
		h.Input(
			h.ID("isbn"),
			h.Name("isbn"),
			h.Class("p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white"),
			h.Type("text"),
			h.Placeholder("ISBN 10 / ISBN 13"),
			h.Value(utils.FirstNonZero(d.ISBN13, d.ISBN10)),
		),
		ui.FormButton(g.Text("Identify"), ""),
	)
}
