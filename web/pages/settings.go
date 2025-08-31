package pages

import (
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/pkg/sliceutils"
	"reichard.io/antholume/web/assets"
	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
	"reichard.io/antholume/web/pages/layout"
)

var _ Page = (*Settings)(nil)

type Settings struct {
	Timezone string
	Devices  []models.Device
}

func (p *Settings) Generate(ctx models.PageContext) (g.Node, error) {
	return layout.Layout(
		ctx.WithRoute(models.SettingsPage),
		h.Div(
			h.Class("flex flex-col md:flex-row gap-4"),
			h.Div(
				h.Div(
					h.Class("flex flex-col p-4 items-center rounded shadow-lg md:w-60 lg:w-80 bg-white dark:bg-gray-700 text-gray-500 dark:text-white"),
					assets.Icon("user", 60),
					h.P(h.Class("text-lg"), g.Text(ctx.UserInfo.Username)),
				),
			),
			h.Div(
				h.Class("flex flex-col gap-4 grow"),
				p.passwordForm(),
				p.timezoneForm(),
				p.devicesTable(),
			),
		),
	)
}

func (p Settings) passwordForm() g.Node {
	return h.Div(
		h.Class("flex flex-col gap-2 p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"),
		h.P(h.Class("text-lg font-semibold"), g.Text("Change Password")),
		h.Form(
			h.Class("flex gap-4 flex-col lg:flex-row"),
			h.Action("./settings"),
			h.Method("POST"),
			// Current Password
			h.Div(
				h.Class("flex grow"),
				h.Span(
					h.Class("inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"),
					assets.Icon("password", 15),
				),
				h.Input(
					h.Type("password"),
					h.ID("password"),
					h.Name("password"),
					h.Class("flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"),
					h.Placeholder("Password"),
				),
			),
			// New Password
			h.Div(
				h.Class("flex grow"),
				h.Span(
					h.Class("inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"),
					assets.Icon("password", 15),
				),
				h.Input(
					h.Type("password"),
					h.ID("new_password"),
					h.Name("new_password"),
					h.Class("flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"),
					h.Placeholder("New Password"),
				),
			),
			// Submit Button
			h.Div(
				h.Class("lg:w-60"),
				ui.FormButton(
					g.Text("Submit"),
					"",
					ui.ButtonConfig{Variant: ui.ButtonVariantSecondary},
				),
			),
		),
	)
}

func (p Settings) timezoneForm() g.Node {
	tzs := []string{
		"Africa/Cairo",
		"Africa/Johannesburg",
		"Africa/Lagos",
		"Africa/Nairobi",
		"America/Adak",
		"America/Anchorage",
		"America/Buenos_Aires",
		"America/Chicago",
		"America/Denver",
		"America/Los_Angeles",
		"America/Mexico_City",
		"America/New_York",
		"America/Nuuk",
		"America/Phoenix",
		"America/Puerto_Rico",
		"America/Sao_Paulo",
		"America/St_Johns",
		"America/Toronto",
		"Asia/Dubai",
		"Asia/Hong_Kong",
		"Asia/Kolkata",
		"Asia/Seoul",
		"Asia/Shanghai",
		"Asia/Singapore",
		"Asia/Tokyo",
		"Atlantic/Azores",
		"Australia/Melbourne",
		"Australia/Sydney",
		"Europe/Berlin",
		"Europe/London",
		"Europe/Moscow",
		"Europe/Paris",
		"Pacific/Auckland",
		"Pacific/Honolulu",
	}

	return h.Div(
		h.Class("flex flex-col grow gap-2 p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"),
		h.P(h.Class("text-lg font-semibold"), g.Text("Change Timezone")),
		h.Form(
			h.Class("flex gap-4 flex-col lg:flex-row"),
			h.Action("./settings"),
			h.Method("POST"),
			h.Div(
				h.Class("flex grow"),
				h.Span(
					h.Class("inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"),
					assets.Icon("clock", 15),
				),
				h.Select(
					h.Class("flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"),
					h.ID("timezone"),
					h.Name("timezone"),
					g.Group(g.Map(tzs, func(tz string) g.Node {
						return h.Option(
							h.Value(tz),
							g.If(tz == p.Timezone, h.Selected()),
							g.Text(tz),
						)
					})),
				),
			),
			h.Div(
				h.Class("lg:w-60"),
				ui.FormButton(
					g.Text("Submit"),
					"",
					ui.ButtonConfig{Variant: ui.ButtonVariantSecondary},
				),
			),
		),
	)
}

func (p Settings) devicesTable() g.Node {
	return h.Div(
		h.Class("flex flex-col grow p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"),
		h.P(h.Class("text-lg font-semibold"), g.Text("Devices")),
		ui.Table(ui.TableConfig{
			Columns: []string{"Name", "Last Sync", "Created"},
			Rows: sliceutils.Map(p.Devices, func(d models.Device) ui.TableRow {
				return ui.TableRow{
					"Name":      ui.TableCell{String: d.DeviceName},
					"Last Sync": ui.TableCell{String: d.LastSynced},
					"Created":   ui.TableCell{String: d.CreatedAt},
				}
			}),
		}),
	)
}
