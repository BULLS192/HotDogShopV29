# ColorLayer V0.3

Local-first artwork decomposition and manufacturing-export prototype.

## What changed from the initial MVP

- Editable palette after decomposition
- Custom layer names and filament/spool names
- Automatic background guess + manual background selection
- Hide/show layers
- Merge unwanted colors without reprocessing the image
- Small-island cleanup
- Real closed contour tracing instead of row-rectangle SVG output
- Douglas-Peucker vector simplification
- Physical output sizing in millimeters
- Per-layer PNG, SVG, DXF and experimental STL export
- Combined color-aware `ASSEMBLY.3mf` for 3MF-capable slicers
- Backing STL generator
- Perimeter frame STL generator
- Optional 2-corner / 4-corner registration markers and backing pins
- Project save/open as JSON
- Dependency-free manufacturing ZIP export with manifest
- Still fully client-side / local

## Run

Open `index.html` directly in Chrome or Edge.

If local browser restrictions interfere, from this folder run:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Recommended workflow

1. Upload artwork.
2. Select 4–8 target colors and moderate pre-smoothing.
3. Decompose.
4. Correct palette colors and name the filament for each layer.
5. Mark the background or merge unwanted colors.
6. Set physical width and layer thickness.
7. Inspect layer contours.
8. Export manufacturing ZIP.
9. Prefer SVG/DXF for final CAD work; use direct STL as a quick prototype.

## Current limitation

V0.3 does not yet generate breakaway carrier frames that physically connect isolated islands within a color layer. That feature is important for the stacked/inlay assembly workflow and is the logical next major manufacturing feature.


## V0.3.1 PWA deployment
- Installable from supported desktop/mobile browsers
- Offline app-shell caching after first successful load
- LIVE/DEV channel badge based on deployment path
- Online/offline indicator
- Service-worker update checks

Deployment paths used in the temporary GitHub Pages host:
- `/colorlayer/` — stable build
- `/colorlayer-dev/` — preview build
