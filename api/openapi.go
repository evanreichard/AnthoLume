package api

import (
	_ "embed"

	"github.com/getkin/kin-openapi/openapi3"
)

//go:embed openapi.yaml
var openAPIYAML []byte

func loadOpenAPISpec() (*openapi3.T, error) {
	return openapi3.NewLoader().LoadFromData(openAPIYAML)
}
