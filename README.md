# Reporte Fotográfico de Calidad (ANTES / DESPUÉS)

App web instalable desde Chrome (PWA). Funciona sin internet una vez instalada; los reportes y fotos se guardan en el propio teléfono o tableta.

## Flujo del supervisor
1. **Importar archivo de Tcar**: la tarjeta de inspección (.xlsx) de la unidad; se pueden elegir varias tarjetas a la vez. También acepta CSV o pegar la tabla.
2. La app toma la unidad (INICIAL + NÚMERO) y la ciudad del encabezado de la tarjeta, y de la tabla de defectos solo UBICACIÓN, MOTIVO y DESCRIPCIÓN. La leyenda queda como `R3 X 64 - RUEDA, 28 PULGADAS 1W HT-CP`. Si algo no se detecta, se corrige en los menús.
3. Elegir las unidades → se crea un reporte por unidad.
4. En cada reporte, pestaña **ANTES**: tocar el recuadro de cada defecto para abrir la cámara. **Saltar** marca los defectos que no requieren foto (no salen en el PDF).
5. Pestaña **DESPUÉS**: lo mismo al terminar el trabajo.
6. **Generar PDF** → Descargar o Compartir (WhatsApp, correo…).

PDF: carta horizontal, 3 fotos por fila, 2 filas por hoja, primero la sección ANTES y luego DESPUÉS, con leyenda bajo cada foto, datos de la unidad y supervisor.

## Publicarla para instalar desde Chrome
Chrome solo permite instalar apps servidas por **HTTPS**. Sube esta carpeta completa (sin `.claude`) a cualquier hosting estático, por ejemplo:

- **Netlify Drop**: entra a app.netlify.com/drop y arrastra la carpeta. Te da una URL https.
- **GitHub Pages**: sube los archivos a un repositorio y activa Pages.

Luego, en el teléfono, abre la URL en Chrome → botón **Instalar** (o menú ⋮ → *Agregar a pantalla principal*).

## Archivos
- `index.html`, `styles.css`, `app.js` — la app
- `manifest.webmanifest`, `sw.js`, `icons/` — instalación y modo sin conexión
- `vendor/` — jsPDF (genera el PDF) y SheetJS (lee Excel/CSV)

Para actualizar la app tras un cambio, sube los archivos y cambia `CACHE` en `sw.js` (p. ej. `reporte-foto-v2`).
