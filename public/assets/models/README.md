# Model layout

Use this folder structure for the active scene models:

- `/assets/models/sun/sun.glb`
- `/assets/models/sun/1k.glb`
- `/assets/models/sun/4k.glb` (optional)
- `/assets/models/earth/earth.glb`
- `/assets/models/earth/1k.glb`
- `/assets/models/earth/4k.glb` (optional)

Rules:

1. Input format for runtime is only `GLB`.
2. The loader tries these names in order: configured path, `<body>.glb`, `model.glb`, `1k.glb`.
3. Models are auto-centered and auto-scaled to each body's configured visual radius.
4. Keep model forward/up axes consistent to avoid unexpected orientation.
