package main

import (
	"fmt"
	"math"
	"math/rand/v2"
	"os"
	"strings"
	"time"
)

// logo is "PORTA" in the figlet standard font, one glyph per letter so the columns always line up.
var logo = [][5]string{
	{" ____  ", "|  _ \\ ", "| |_) |", "|  __/ ", "|_|    "},
	{"  ___  ", " / _ \\ ", "| | | |", "| |_| |", " \\___/ "},
	{" ____  ", "|  _ \\ ", "| |_) |", "|  _ < ", "|_| \\_\\"},
	{" _____ ", "|_   _|", "  | |  ", "  | |  ", "  |_|  "},
	{"    _    ", "   / \\   ", "  / _ \\  ", " / ___ \\ ", "/_/   \\_\\"},
}

const (
	meadowWidth = 64
	meadowRows  = 5
)

// Colors are xterm-256 codes: the logo fades from mint to deep green, grass is lighter at the tips than at the roots.
var (
	logoColors  = [5]string{"157", "120", "84", "41", "35"}
	grassColors = [meadowRows]string{"156", "113", "77", "70", "28"}
	soilColor   = "94"
	flowerHues  = []string{"221", "218", "255", "183", "209"}
)

type blade struct {
	height int              // rows tall, 0 (a gap) to meadowRows
	flower string           // color of the flower on top, "" for plain grass
	stems  [meadowRows]byte // character of the stem on each row
}

type meadow struct {
	blades []blade
	soil   string
	color  bool
}

func newMeadow(color bool) *meadow {
	m := &meadow{color: color}
	for range meadowWidth {
		h := 1 + rand.IntN(3)
		if rand.IntN(5) == 0 {
			h += 2
		}
		if rand.IntN(10) == 0 {
			h = 0
		}
		b := blade{height: min(h, meadowRows)}
		for r := range b.stems {
			b.stems[r] = "||||||/\\"[rand.IntN(8)]
		}
		if b.height >= 3 && rand.IntN(8) == 0 {
			b.flower = flowerHues[rand.IntN(len(flowerHues))]
		}
		m.blades = append(m.blades, b)
	}
	soil := make([]byte, meadowWidth)
	for i := range soil {
		soil[i] = ".,:;'`.,"[rand.IntN(8)]
	}
	m.soil = string(soil)
	return m
}

func (m *meadow) paint(code, s string) string {
	if !m.color || s == "" {
		return s
	}
	return "\x1b[38;5;" + code + "m" + s + "\x1b[0m"
}

// frame draws the meadow at time t. A slow wave of wind runs across it and leans the tips of the blades.
func (m *meadow) frame(t int) string {
	var out strings.Builder
	for r := range meadowRows {
		var row strings.Builder
		out.WriteString("  ")
		flush := func(code string) { out.WriteString(m.paint(code, row.String())); row.Reset() }
		for x, b := range m.blades {
			top := meadowRows - b.height
			switch {
			case r < top:
				row.WriteByte(' ')
			case r == top && b.flower != "":
				flush(grassColors[r])
				out.WriteString(m.paint(b.flower, "*"))
			case r == top || r == top+1:
				lean := math.Sin(float64(t)*0.22-float64(x)*0.17) + 0.45*math.Sin(float64(t)*0.09-float64(x)*0.05)
				if r == top+1 {
					lean *= 0.55
				}
				switch {
				case lean > 0.7:
					row.WriteByte('/')
				case lean < -0.7:
					row.WriteByte('\\')
				case r == top:
					row.WriteByte('|')
				default:
					row.WriteByte(b.stems[r])
				}
			default:
				row.WriteByte(b.stems[r])
			}
		}
		flush(grassColors[r])
		out.WriteString("\n")
	}
	out.WriteString("  " + m.paint(soilColor, m.soil) + "\n")
	return out.String()
}

// banner prints the logo, where Porta is running, and a meadow that sways while Porta runs.
// Without a color terminal (output piped to a file, NO_COLOR set) it prints the same text, still.
func banner(url, dir string) {
	color := os.Getenv("NO_COLOR") == "" && enableANSI()
	setTitle("Porta")
	m := newMeadow(color)
	var b strings.Builder
	b.WriteString("\n")
	for r := range 5 {
		var line strings.Builder
		for _, g := range logo {
			line.WriteString(g[r])
		}
		b.WriteString("  " + m.paint(logoColors[r], line.String()) + "\n")
	}
	b.WriteString("\n")
	b.WriteString("  " + m.paint("252", "Running at   ") + m.paint("229", url) + "\n")
	b.WriteString("  " + m.paint("252", "Data folder  ") + m.paint("250", dir) + "\n")
	b.WriteString("  " + m.paint("245", "Close this window to quit.") + "\n\n")
	b.WriteString(m.frame(0))
	fmt.Print(b.String())
	if !color {
		return
	}
	go func() {
		fmt.Print("\x1b[?25l") // hide the cursor so it does not blink inside the grass
		lines := meadowRows + 1
		for t := 1; ; t++ {
			time.Sleep(150 * time.Millisecond)
			fmt.Printf("\x1b[%dA\r%s", lines, m.frame(t))
		}
	}()
}
