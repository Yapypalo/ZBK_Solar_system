# Model layout

Use this folder structure for planetary models:

- `/assets/models/sun/sun.glb`
- `/assets/models/sun/1k.glb`
- `/assets/models/sun/4k.glb` (optional)
- `/assets/models/mercury/mercury.glb`
- `/assets/models/venus/venus.glb`
- `/assets/models/earth/earth.glb`
- `/assets/models/mars/mars.glb`
- `/assets/models/moon/moon.glb`
- `/assets/models/phobos/phobos.glb`
- `/assets/models/deimos/deimos.glb`

Rules:

1. Input format for runtime is only `GLB`.
2. The loader tries these names in order: configured path, `<body>.glb`, `model.glb`, `1k.glb`.
3. Models are auto-centered and auto-scaled to each body's configured visual radius.
4. Keep model forward/up axes consistent to avoid unexpected orientation.
