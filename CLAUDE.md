# Vela Capital Management — web

Web estática publicada con GitHub Pages en https://gmanaua.github.io/vela-capital/ (rama `main`, raíz).

## Arquitectura
- `index.html`: maquetación y todo el CSS (estilo editorial: Instrument Sans, grafito #3a3a3e sobre blanco, tintes melocotón/lavanda/azul/fucsia solo como fondos de tarjeta, esquinas a 0 px, sin sombras).
- `app.js`: lógica. Carga los datos de `window.VELA_API` (definido en `index.html`), calcula rentabilidad ponderada por tiempo, meses, bloques, riesgo (volatilidad, máxima caída, Sharpe, Sortino, beta, correlación) y pinta los gráficos en SVG a mano.
- `apps-script/Codigo.gs`: script de Google Apps Script que vive dentro de la Google Sheet de Gerard. NO se ejecuta desde aquí: se copia en Extensiones → Apps Script y se publica como aplicación web (Implementar → Gestionar implementaciones → Nueva versión). Lee las pestañas WEB, CARTERA, PATRIMONIO, IDEAS, BITÁCORA y EXPOSICION y devuelve JSON.
- Exposición: pestaña EXPOSICION (Pestaña | Categoría | % | Datos a), creada con el menú Vela web → Crear pestaña EXPOSICION. Llega como `exposicion: [{ nombre, fecha, items: [{ nombre, pct }] }]`; cada valor distinto de "Pestaña" es una pestaña en la web. Sin datos, la sección se oculta.
- `tesis/index.json`: mapa ticker → archivo HTML de tesis (`{"NFLX": {"archivo": "tesis/nflx.html", "fecha": "2026-09-15"}}`). Las posiciones con tesis muestran "Leer tesis".
- `assets/`: logo, retrato, imagen para compartir (og.jpg) y fondo de la sección privada.

## Datos y privacidad
- Sin contraseña, el script devuelve solo porcentajes (`cartera[].r`, `posiciones[].peso/rent`, `cashPct`, `bench`, `bitacora`, `ideas`).
- Con `?key=` correcta añade importes en euros (`valor`, `invertido`, `patrimonio`, `cash`, `realizado`). La contraseña se guarda en las propiedades del script, nunca en este repositorio.
- No subir nunca datos financieros en euros ni contraseñas a este repositorio (es público).

## Comparación con el MSCI World
- La calcula el script (`referencia()`), con cierres diarios de IWDA.AS desde Yahoo Finance, en caché 6 h. Llega como `bench: { nombre, simbolo, acum: [...] }`, alineado con `cartera`.
- Si `bench` falta o es `null`, la web oculta la línea discontinua, la tarjeta "Frente al MSCI World" y la beta/correlación.
- Si no aparece en la web: comprobar que la URL `/exec` devuelve `bench` y que se publicó una "Nueva versión" de la implementación tras el último cambio del script.

## Histórico anterior a la Sheet
- La pestaña CARTERA empieza el 6/3/2026. Lo anterior (desde el 3/3/2025) está en `historico.json`: rentabilidad semanal y MSCI World, solo porcentajes.
- Lo genera `herramientas/historico.js` a partir del CSV "Todas las transacciones" de Portfolio Performance y cierres de Yahoo: reconstruye la cartera día a día (solo lo invertido, sin liquidez) y calcula la rentabilidad ponderada por tiempo. El CSV tiene importes en euros y NO se sube.
- `app.js` (`conHistorico`) lo pone delante de la serie de la Sheet solo si su última fecha coincide con la primera de CARTERA; si no enlaza, se ignora y la web funciona como antes.
- No usar el gráfico de rendimiento de Portfolio Performance como fuente: incluye liquidez y tiene cotizaciones erróneas (marzo 2025, 17/7/2026).

## Cambios
- `app.js` se carga con `?v=<hash>` para evitar cachés: si se edita `app.js`, actualizar ese parámetro en `index.html`.
- Las cifras usan formato es-ES (coma decimal, punto de miles, signo menos tipográfico).
