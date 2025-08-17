package ui

import (
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/pkg/sliceutils"
	"reichard.io/antholume/pkg/utils"
)

type ButtonVariant string

const (
	ButtonVariantPrimary   ButtonVariant = "primary"
	ButtonVariantSecondary ButtonVariant = "secondary"
	ButtonVariantGhost     ButtonVariant = "ghost"
)

type buttonAs int

const (
	buttonAsLink buttonAs = iota
	buttonAsForm
	buttonAsSpan
)

type ButtonConfig struct {
	Variant  ButtonVariant
	Disabled bool

	as    buttonAs
	value string
}

// LinkButton creates a button that links to a url. The default variant is ButtonVariantPrimary.
func LinkButton(content g.Node, url string, cfg ...ButtonConfig) g.Node {
	config := buildButtonConfig(cfg, buttonAsLink, url)
	return button(content, config)
}

// FormButton creates a button that is a form. The default variant is ButtonVariantPrimary.
func FormButton(content g.Node, formName string, cfg ...ButtonConfig) g.Node {
	config := buildButtonConfig(cfg, buttonAsForm, formName)
	return button(content, config)
}

// SpanButton creates a button that has no target (i.e. span). The default variant is ButtonVariantPrimary.
func SpanButton(content g.Node, cfg ...ButtonConfig) g.Node {
	config := buildButtonConfig(cfg, buttonAsSpan, "")
	return button(content, config)
}

func button(content g.Node, config ButtonConfig) g.Node {
	classes := config.getClasses()
	if config.as == buttonAsSpan || config.Disabled {
		return h.Span(content, h.Class(classes))
	} else if config.as == buttonAsLink {
		return h.A(h.Class(classes), h.Href(config.value), content)
	}

	return h.Button(
		content,
		h.Type("submit"),
		h.Class(classes),
		g.If(config.value != "", h.FormAttr(config.value)),
	)
}

func (c *ButtonConfig) getClasses() string {
	baseClass := "transition duration-100 ease-in font-medium text-center inline-block"

	var variantClass string
	switch c.Variant {
	case ButtonVariantPrimary:
		variantClass = "h-full w-full px-2 py-1 text-white bg-gray-500 dark:text-gray-800 hover:bg-gray-800 dark:hover:bg-gray-100"
	case ButtonVariantSecondary:
		variantClass = "h-full w-full px-2 py-1 text-white bg-black shadow-md hover:text-black hover:bg-white"
	case ButtonVariantGhost:
		variantClass = "text-gray-500 hover:text-gray-800 dark:hover:text-gray-100"
	}

	classes := baseClass + " " + variantClass

	if c.Disabled {
		classes += " opacity-40 pointer-events-none"
	}

	return classes
}

func buildButtonConfig(cfg []ButtonConfig, as buttonAs, val string) ButtonConfig {
	c, found := sliceutils.First(cfg)
	if !found {
		c = ButtonConfig{Variant: ButtonVariantPrimary}
	}
	c.Variant = utils.FirstNonZero(c.Variant, ButtonVariantPrimary)
	c.as = as
	c.value = val
	return c
}
