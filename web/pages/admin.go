package pages

import (
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"

	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
	"reichard.io/antholume/web/pages/layout"
)

var _ Page = (*AdminGeneral)(nil)

type AdminGeneral struct{}

func (p *AdminGeneral) Generate(ctx models.PageContext) (g.Node, error) {
	return layout.Layout(
		ctx.WithRoute(models.AdminGeneralPage),
		h.Div(
			h.Class("w-full flex flex-col gap-4 grow"),
			backupAndRestoreSection(),
			tasksSection(),
		),
	)
}

func backupAndRestoreSection() g.Node {
	return h.Div(
		h.Class("flex flex-col gap-2 grow p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"),
		h.P(
			h.Class("text-lg font-semibold mb-2"),
			g.Text("Backup & Restore"),
		),
		h.Div(
			h.Class("flex flex-col gap-4"),
			backupForm(),
			restoreForm(),
		),
	)
}

func backupForm() g.Node {
	return h.Form(
		h.Class("flex justify-between"),
		h.Action("./admin"),
		h.Method("POST"),
		h.Input(
			h.Type("text"),
			h.Name("action"),
			h.Value("BACKUP"),
			h.Class("hidden"),
		),
		h.Div(
			h.Class("flex gap-8"),
			h.Div(
				h.Class("flex gap-2 items-center"),
				h.Input(
					h.Type("checkbox"),
					h.ID("backup_covers"),
					h.Name("backup_types"),
					h.Value("COVERS"),
				),
				h.Label(
					h.For("backup_covers"),
					g.Text("Covers"),
				),
			),
			h.Div(
				h.Class("flex gap-2 items-center"),
				h.Input(
					h.Type("checkbox"),
					h.ID("backup_documents"),
					h.Name("backup_types"),
					h.Value("DOCUMENTS"),
				),
				h.Label(
					h.For("backup_documents"),
					g.Text("Documents"),
				),
			),
		),
		h.Div(
			h.Class("h-10 w-40"),
			ui.FormButton(g.Text("Backup"), "", ui.ButtonConfig{Variant: ui.ButtonVariantSecondary}),
		),
	)
}

func restoreForm() g.Node {
	return h.Form(
		h.Class("flex justify-between"),
		h.Action("./admin"),
		h.Method("POST"),
		g.Attr("enctype", "multipart/form-data"),
		h.Input(
			h.Type("text"),
			h.Name("action"),
			h.Value("RESTORE"),
			h.Class("hidden"),
		),
		h.Div(
			h.Class("flex items-center"),
			h.Input(
				h.Type("file"),
				h.Accept(".zip"),
				h.Name("restore_file"),
				h.Class("w-full"),
			),
		),
		h.Div(
			h.Class("h-10 w-40"),
			ui.FormButton(g.Text("Restore"), "", ui.ButtonConfig{Variant: ui.ButtonVariantSecondary}),
		),
	)
}

func tasksSection() g.Node {
	return h.Div(
		h.Class("flex flex-col grow p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"),
		h.P(
			h.Class("text-lg font-semibold mb-4"),
			g.Text("Tasks"),
		),
		h.Div(
			h.Class("grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 items-center"),
			g.Group(taskItem("Metadata Matching", "METADATA_MATCH")),
			g.Group(taskItem("Cache Tables", "CACHE_TABLES")),
		),
	)
}

func taskItem(name, action string) []g.Node {
	return []g.Node{
		h.P(
			h.Class("text-black dark:text-white"),
			g.Text(name),
		),
		h.Form(
			h.Action("./admin"),
			h.Method("POST"),
			h.Input(
				h.Type("text"),
				h.Name("action"),
				h.Value(action),
				h.Class("hidden"),
			),
			h.Div(
				h.Class("h-10 w-40"),
				ui.FormButton(g.Text("Run"), "", ui.ButtonConfig{Variant: ui.ButtonVariantSecondary}),
			),
		),
	}
}
