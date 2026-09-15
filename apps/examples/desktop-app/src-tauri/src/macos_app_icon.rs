use block2::RcBlock;
use objc2::{rc::Retained, runtime::Bool};
use objc2_app_kit::NSImage;
use objc2_foundation::{NSPoint, NSRect, NSSize};

/// AppKit scales a runtime application icon to fill its Dock tile. Unlike
/// bundled icons, our full-bleed PNG variants need their own transparent inset.
/// Preserve the source artwork's aspect ratio and existing shadows. Hologram's
/// double border needs a slightly larger footprint to look balanced alongside
/// solid-background icons in the Dock.
pub fn padded_app_icon(source: Retained<NSImage>, icon: &str) -> Retained<NSImage> {
    let canvas = NSSize::new(512.0, 512.0);
    let source_size = source.size();
    let body_fraction = if icon == "hologram" {
        0.84
    } else {
        824.0 / 1024.0
    };
    // A drawing-backed image lets AppKit render at the Dock's current scale;
    // changing NSImage.size alone would still stretch the artwork to the tile.
    let draw = RcBlock::new(move |bounds: NSRect| {
        let scale = (bounds.size.width.min(bounds.size.height) * body_fraction)
            / source_size.width.max(source_size.height).max(1.0);
        let size = NSSize::new(source_size.width * scale, source_size.height * scale);
        let rect = NSRect::new(
            NSPoint::new(
                bounds.origin.x + (bounds.size.width - size.width) / 2.0,
                bounds.origin.y + (bounds.size.height - size.height) / 2.0,
            ),
            size,
        );
        source.drawInRect(rect);
        Bool::YES
    });
    NSImage::imageWithSize_flipped_drawingHandler(canvas, false, &draw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::AllocAnyThread;
    use objc2_app_kit::NSBitmapImageRep;
    use objc2_foundation::NSString;

    #[test]
    fn runtime_variants_render_with_transparent_dock_margins() {
        for icon in ["classic", "midnight", "hologram", "chip"] {
            for canvas_size in [128.0, 512.0] {
                let path = format!("{}/icons/app/{icon}.png", env!("CARGO_MANIFEST_DIR"));
                let source =
                    NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(&path))
                        .expect("bundled icon should load");
                let padded = padded_app_icon(source, icon);
                padded.setSize(NSSize::new(canvas_size, canvas_size));
                // Rasterize the actual AppKit drawing callback, after its local
                // block and source handles have been dropped by the helper.
                let data = padded.TIFFRepresentation().expect("icon should render");
                let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &data)
                    .expect("rendered icon should decode");
                let width = bitmap.pixelsWide();
                let height = bitmap.pixelsHigh();
                let mut left = width;
                let mut right = 0;
                let mut top = height;
                let mut bottom = 0;
                for y in 0..height {
                    for x in 0..width {
                        if bitmap.colorAtX_y(x, y).unwrap().alphaComponent() > 0.5 {
                            left = left.min(x);
                            right = right.max(x + 1);
                            top = top.min(y);
                            bottom = bottom.max(y + 1);
                        }
                    }
                }
                let body_width = (right - left) as f64 / width as f64;
                let body_height = (bottom - top) as f64 / height as f64;
                let expected_body = if icon == "hologram" {
                    0.83..0.85
                } else {
                    0.77..0.83
                };
                assert!(expected_body.contains(&body_width), "{icon}: {body_width}");
                assert!(
                    expected_body.contains(&body_height),
                    "{icon}: {body_height}"
                );
                assert!(left > width / 16 && top > height / 16, "{icon}: inset");
                assert!(
                    right < width * 15 / 16 && bottom < height * 15 / 16,
                    "{icon}: inset"
                );
                assert_eq!(bitmap.colorAtX_y(0, 0).unwrap().alphaComponent(), 0.0);
            }
        }
    }
}
