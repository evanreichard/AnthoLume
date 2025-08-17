package ui

import (
	"fmt"

	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
)

type TableRow map[string]TableCell

type TableCell struct {
	String string
	Value  g.Node
}

type TableConfig struct {
	Columns []string
	Rows    []TableRow
}

func Table(cfg TableConfig) g.Node {
	return h.Table(
		h.Class("min-w-full leading-normal bg-white dark:bg-gray-700 text-sm"),
		h.THead(
			h.Class("text-gray-800 dark:text-gray-400"),
			h.Tr(
				g.Map(cfg.Columns, func(col string) g.Node {
					return h.Th(
						h.Class("p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"),
						g.Text(col),
					)
				})...,
			),
		),
		h.TBody(
			h.Class("text-black dark:text-white"),
			g.If(len(cfg.Rows) == 0,
				h.Tr(
					h.Td(
						h.Class("text-center p-3"),
						g.Attr("colspan", fmt.Sprintf("%d", len(cfg.Columns))),
						g.Text("No Results"),
					),
				),
			),
			g.Map(cfg.Rows, func(row TableRow) g.Node {
				return h.Tr(
					g.Map(cfg.Columns, func(col string) g.Node {
						cell, ok := row[col]
						content := cell.Value
						if !ok || content == nil {
							content = g.Text(cell.String)
						}
						return h.Td(
							h.Class("p-3 border-b border-gray-200"),
							content,
						)
					})...,
				)
			}),
		),
	)
}
