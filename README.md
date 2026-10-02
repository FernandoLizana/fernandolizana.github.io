# Fernando Lizana · Universo de proyectos

Cada estrella de esta galaxia es un repositorio público de [FernandoLizana](https://github.com/FernandoLizana). El visitante entra directo a la escena, puede girarla, buscar un proyecto y abrir su ficha. Si WebGL no está disponible, la lista de proyectos sigue mostrando los mismos datos y enlaces.

## Empezar

```bash
npm install
npm test
npm run sync
npm run dev
```

`npm run dev` abre el sitio en local. `npm run sync` vuelve a leer los repositorios públicos y solo sustituye `public/catalog.json` si la descarga está completa. `npm run build` comprueba ese catálogo y genera `dist/`. `npm run preview` sirve la compilación.

Los repositorios de cuando estaba aprendiendo a programar están en `scripts/excluded-repos.json` y no aparecen. El repositorio del perfil, `FernandoLizana`, tampoco: es la presentación, no un proyecto. Por eso GitHub puede mostrar más repositorios públicos que la galaxia: la sincronización descarga todas las páginas, compara el total con el perfil y después aplica esa lista. Un repositorio público nuevo, que no esté en ella, entra solo en la próxima sincronización.

Los textos de las fichas y el orden de los destacados viven en `public/editorial.json`. Si un nombre de ahí no está en el catálogo público, no se muestra.

## Publicar en GitHub Pages

El sitio queda en [https://fernandolizana.github.io/](https://fernandolizana.github.io/), dentro de [fernandolizana.github.io](https://github.com/FernandoLizana/fernandolizana.github.io). El dominio `fernandolizana.tk` ya no existe, así que se quitó: si seguía en el `CNAME`, GitHub intentaba abrir el portafolio por un dominio que no resuelve.

Los recursos usan rutas relativas. En el repositorio:

1. Sube la rama `main` (o `master`).
2. En Settings → Pages, elige GitHub Actions como origen.
3. El workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) se ejecuta al publicar, cada día a las 07:20 UTC y cuando se lanza a mano.
4. Descarga el catálogo con el `GITHUB_TOKEN` del propio workflow. Ese token no llega al navegador.
5. Si la API falla, queda incompleta o no coincide con el total del perfil, el archivo anterior se conserva y el sitio no se vuelve a publicar.
6. Si el catálogo cambió, el workflow intenta guardarlo en el repositorio con `[skip ci]`. Un fallo de ese commit no impide la publicación ya compilada.

## Perfil de GitHub

El perfil público está en [FernandoLizana/FernandoLizana](https://github.com/FernandoLizana/FernandoLizana), con el banner y el enlace al portafolio. La biografía y [digitalriderspa.com](https://digitalriderspa.com/) se mantienen en esa presentación. Las copias de trabajo viven en `profile/`.

## Qué se comprueba

- La descarga sigue pidiendo todos los repositorios públicos y exige que el total coincida con el perfil. Después se omiten los nombres de `scripts/excluded-repos.json`.
- Hay pruebas de más de 100 repositorios, de un fallo de red, de un límite de API y de esa exclusión. Una descarga incompleta no reemplaza el catálogo.
- La lista sigue funcionando sin WebGL, con los mismos datos que la galaxia.

Las capturas están en `docs/capturas/`.

Queda pendiente el gesto real de pinza en un teléfono. El viewport móvil sí se revisó en un navegador de escritorio.
