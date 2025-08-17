package assets

import (
	"embed"
	"fmt"
	"io/fs"

	g "maragu.dev/gomponents"
)

//go:embed svgs/*
var assets embed.FS

func Asset(name string) g.Node {
	b, err := fs.ReadFile(assets, name)
	if err != nil {
		fmt.Println(err)
	}
	return g.Raw(string(b))
}
