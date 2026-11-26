package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
)

// jpegsToPDF builds one PDF with one page per JPEG, in the given order. Pages are A4 width.
func jpegsToPDF(pages [][]byte) ([]byte, error) {
	var buf bytes.Buffer
	var offsets []int
	obj := func(body string, stream []byte) {
		offsets = append(offsets, buf.Len())
		fmt.Fprintf(&buf, "%d 0 obj\n%s", len(offsets), body)
		if stream != nil {
			buf.WriteString("\nstream\n")
			buf.Write(stream)
			buf.WriteString("\nendstream")
		}
		buf.WriteString("\nendobj\n")
	}
	buf.WriteString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
	n := len(pages)
	kids := ""
	for i := range n {
		kids += fmt.Sprintf("%d 0 R ", 3+i*3)
	}
	obj("<< /Type /Catalog /Pages 2 0 R >>", nil)
	obj(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", kids, n), nil)
	for i, jpg := range pages {
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(jpg))
		if err != nil {
			return nil, fmt.Errorf("page %d: %w", i+1, err)
		}
		space := colorSpace(cfg)
		w, h := 595.0, 595.0*float64(cfg.Height)/float64(cfg.Width)
		img, content := 4+i*3, 5+i*3
		obj(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>", w, h, img, content), nil)
		obj(fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>", cfg.Width, cfg.Height, space, len(jpg)), jpg)
		draw := fmt.Sprintf("q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q", w, h)
		obj(fmt.Sprintf("<< /Length %d >>", len(draw)), []byte(draw))
	}
	xref := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, off := range offsets {
		fmt.Fprintf(&buf, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, xref)
	return buf.Bytes(), nil
}

func colorSpace(cfg image.Config) string {
	switch cfg.ColorModel {
	case color.GrayModel:
		return "/DeviceGray"
	case color.CMYKModel:
		return "/DeviceCMYK"
	}
	return "/DeviceRGB"
}
