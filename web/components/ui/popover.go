package ui

import (
	"strings"

	"github.com/google/uuid"
	g "maragu.dev/gomponents"
	h "maragu.dev/gomponents/html"
	"reichard.io/antholume/pkg/ptr"
	"reichard.io/antholume/pkg/sliceutils"
	"reichard.io/antholume/pkg/utils"
)

type PopoverPosition string

const (
	// ---- Cornered ----

	// PopoverTopLeft      PopoverPosition = "left-0 top-0 origin-bottom-right -translate-x-full -translate-y-full"
	// PopoverTopRight     PopoverPosition = "right-0 top-0 origin-bottom-left translate-x-full -translate-y-full"
	// PopoverBottomLeft   PopoverPosition = "left-0 bottom-0 origin-top-right -translate-x-full translate-y-full"
	// PopoverBottomRight  PopoverPosition = "right-0 bottom-0 origin-top-left translate-x-full translate-y-full"

	// ---- Flush ----

	PopoverTopLeft     PopoverPosition = "right-0 -top-1 origin-bottom-right -translate-y-full"
	PopoverTopRight    PopoverPosition = "left-0 -top-1 origin-bottom-left -translate-y-full"
	PopoverBottomLeft  PopoverPosition = "right-0 -bottom-1 origin-top-right translate-y-full"
	PopoverBottomRight PopoverPosition = "left-0 -bottom-1 origin-top-left translate-y-full"

	// ---- Centered ----

	PopoverTopCenter    PopoverPosition = "left-1/2 top-0 origin-bottom -translate-x-1/2 -translate-y-full"
	PopoverBottomCenter PopoverPosition = "left-1/2 bottom-0 origin-top -translate-x-1/2 translate-y-full"
	PopoverLeftCenter   PopoverPosition = "left-0 top-1/2 origin-right -translate-x-full -translate-y-1/2"
	PopoverRightCenter  PopoverPosition = "right-0 top-1/2 origin-left translate-x-full -translate-y-1/2"
	PopoverCenter       PopoverPosition = "left-1/2 top-1/2 origin-center -translate-x-1/2 -translate-y-1/2"
)

type PopoverConfig struct {
	Position PopoverPosition
	Classes  string
	Dim      *bool
}

// AnchoredPopover creates a popover with content anchored to the anchor node.
// The default position is PopoverBottomRight.
func AnchoredPopover(anchor, content g.Node, cfg ...PopoverConfig) g.Node {
	// Get Popover Config
	c, _ := sliceutils.First(cfg)
	c.Position = utils.FirstNonZero(c.Position, PopoverBottomRight)
	if c.Dim == nil {
		c.Dim = ptr.Of(false)
	}

	popoverID := uuid.NewString()
	return h.Div(
		h.Class("relative"),
		h.Label(
			h.Class("cursor-pointer"),
			h.For(popoverID),
			anchor,
		),
		h.Input(
			h.ID(popoverID),
			h.Class("hidden css-button"),
			h.Type("checkbox"),
		),
		Popover(content, c),
	)
}

func Popover(content g.Node, cfg ...PopoverConfig) g.Node {
	// Get Popover Config
	c, _ := sliceutils.First(cfg)
	c.Position = utils.FirstNonZero(c.Position, PopoverCenter)
	if c.Dim == nil {
		c.Dim = ptr.Of(true)
	}

	wrappedContent := h.Div(h.Class(c.getClasses()), content)
	if !ptr.Deref(c.Dim) {
		return wrappedContent
	}

	return h.Div(
		h.Div(h.Class("fixed top-0 left-0 bg-black z-40 opacity-50 w-screen h-screen")),
		wrappedContent,
	)
}

func (c *PopoverConfig) getClasses() string {
	return strings.Join([]string{
		"absolute z-50 p-2 transition-all duration-200 rounded shadow-lg",
		"bg-gray-200 dark:bg-gray-600 shadow-gray-500 dark:shadow-gray-900",
		c.Classes,
		string(c.Position),
	}, " ")
}
