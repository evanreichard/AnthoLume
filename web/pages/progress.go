package pages

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/pkg/sliceutils"
	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
)

var _ Page = (*Progress)(nil)

type Progress struct {
	Data []models.Progress
}

func (Progress) Route() PageRoute { return ProgressPage }

func (p Progress) Render() g.Node {
	return h.Div(
		h.Class("overflow-x-auto"),
		h.Div(
			h.Class("inline-block min-w-full overflow-hidden rounded shadow"),
			ui.Table(p.buildTableConfig()),
		),
	)
}

func (p *Progress) buildTableConfig() ui.TableConfig {
	return ui.TableConfig{
		Columns: []string{"Document", "Device Name", "Percentage", "Created At"},
		Rows:    sliceutils.Map(p.Data, toProgressTableRow),
	}
}

func toProgressTableRow(r models.Progress) ui.TableRow {
	return ui.TableRow{
		"Document": ui.TableCell{
			Value: h.A(
				h.Href(fmt.Sprintf("./documents/%s", r.ID)),
				g.Text(fmt.Sprintf("%s - %s", r.Author, r.Title)),
			),
		},
		"Device Name": ui.TableCell{
			String: r.DeviceName,
		},
		"Percentage": ui.TableCell{
			String: fmt.Sprintf("%.2f%%", r.Percentage),
		},
		"Created At": ui.TableCell{
			String: r.CreatedAt,
		},
	}
}
