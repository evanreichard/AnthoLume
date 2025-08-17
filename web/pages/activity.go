package pages

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/pkg/formatters"
	"reichard.io/antholume/pkg/sliceutils"
	"reichard.io/antholume/web/components/ui"
	"reichard.io/antholume/web/models"
)

var _ Page = (*Activity)(nil)

type Activity struct {
	Data []models.Activity
}

func (Activity) Route() PageRoute { return ActivityPage }

func (p Activity) Render() g.Node {
	return h.Div(
		h.Class("overflow-x-auto"),
		h.Div(
			h.Class("inline-block min-w-full overflow-hidden rounded shadow"),
			ui.Table(p.buildTableConfig()),
		),
	)
}

func (p *Activity) buildTableConfig() ui.TableConfig {
	return ui.TableConfig{
		Columns: []string{"Document", "Time", "Duration", "Percent"},
		Rows:    sliceutils.Map(p.Data, toActivityTableRow),
	}
}

func toActivityTableRow(r models.Activity) ui.TableRow {
	return ui.TableRow{
		"Document": ui.TableCell{
			Value: h.A(
				h.Href(fmt.Sprintf("./documents/%s", r.ID)),
				g.Text(fmt.Sprintf("%s - %s", r.Author, r.Title)),
			),
		},
		"Time": ui.TableCell{
			String: r.StartTime,
		},
		"Duration": ui.TableCell{
			String: formatters.FormatDuration(r.Duration),
		},
		"Percent": ui.TableCell{
			String: fmt.Sprintf("%.2f%%", r.Percentage),
		},
	}
}
