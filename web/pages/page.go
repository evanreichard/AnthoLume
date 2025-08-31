package pages

import (
	g "maragu.dev/gomponents"
	"reichard.io/antholume/web/models"
)

type Page interface {
	Generate(ctx models.PageContext) (g.Node, error)
}
