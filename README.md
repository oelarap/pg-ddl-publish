# pg-ddl-publish

CLI en Node.js para comparar una carpeta de SQL contra PostgreSQL y generar un script de publicacion.

Documentacion en ingles: [README.en.md](README.en.md).

## Que hace

- Toma una carpeta raiz con archivos `.sql`.
- Ejecuta `pre_script` primero (si existe).
- Reconstruye un estado deseado en una base **scratch**.
- Compara **target vs scratch** con `@pgkit/migra`.
- Genera un archivo SQL de publicacion.
- Puede aplicar la publicacion en target y luego ejecutar `post_script`.

## Requisitos

- Node.js 18+
- PostgreSQL accesible desde tu maquina
- Dos conexiones:
  - **target**: base a comparar / publicar
  - **scratch**: base temporal para reconstruir el estado deseado

## Instalacion

En el directorio del proyecto (clon o copia de esta carpeta):

```bash
npm install
```

## Estructura esperada (ejemplo)

```text
mi-carpeta-ddl/
  pre_script/
    extension.unaccent.sql
  funciones/
  tablas/
  secuencias/
  post_script/
    001_fix_post.sql
```

- Todo lo que este en `pre_script/` se ejecuta antes del DDL principal.
- Todo lo que este en `post_script/` se ejecuta al final de `apply`/`publish`.
- Los SQL de `pre_script` y `post_script` se excluyen del bloque DDL principal para el diff.

## Configuracion

Si no tienes `ddl-publish.config.json`, la herramienta usa como respaldo `ddl-publish.config.example.json` del mismo directorio (y muestra un aviso en consola).

Copia el ejemplo a `ddl-publish.config.json` y ajusta valores para tu entorno:

```json
{
  "targetUrl": "postgresql://postgres:postgres@localhost:5432/myapp",
  "scratchUrl": "postgresql://postgres:postgres@localhost:5432/myapp_scratch_ddl",
  "schema": "app",
  "folder": "/ruta/absoluta/a/mi-carpeta-ddl",
  "preScriptDirName": "pre_script",
  "postScriptDirName": "post_script",
  "excludeDdlGlobs": ["secuencias/**"],
  "outputFile": "./out/publicacion.sql"
}
```

En Windows puedes usar rutas como `C:/proyecto/mi-carpeta-ddl` en el JSON.


Tambien puedes usar variables de entorno:

- `DDL_PUBLISH_TARGET_URL`
- `DDL_PUBLISH_SCRATCH_URL`
- `DDL_PUBLISH_SCHEMA`
- `DDL_PUBLISH_OUTPUT`

## Comandos

Desde el directorio donde instalaste dependencias (`npm install`), usando la ruta real a tu carpeta DDL:

### 1) Generar script

```bash
node src/cli.js generate -f "/ruta/absoluta/a/mi-carpeta-ddl" --unsafe
```

Salida “release” en la carpeta de BD (timestamp local):

```bash
node src/cli.js generate -f "/ruta/absoluta/a/mi-carpeta-ddl" --unsafe --to-prod
```

Equivale a `--toProd`. El archivo queda en `{folder}/release/release_dd_MM_yyyy_HH_mm_ss.sql` y **anula** `--output`. La carpeta `release/` **no** se incluye en el DDL al comparar (para no ejecutar publicaciones viejas en el scratch).

Opciones importantes:

- `--exclude-ddl 'secuencias/**'` (repetible): omite archivos del DDL principal; evita colision `*_seq` vs `serial`.
- `--resolver strict|smart` (default: `smart`)
  - `strict`: falla al primer error.
  - `smart`: reintenta por rondas dependencias faltantes (tabla/funcion/objeto).
- `--unsafe`: permite que migra incluya operaciones destructivas (`DROP`).

### 2) Aplicar script generado + post_script

```bash
node src/cli.js apply -f "/ruta/absoluta/a/mi-carpeta-ddl" -p "./out/publicacion.sql"
```

### 3) Flujo completo

```bash
node src/cli.js publish -f "/ruta/absoluta/a/mi-carpeta-ddl" --unsafe
```

Con release versionado en la carpeta de BD:

```bash
node src/cli.js publish -f "/ruta/absoluta/a/mi-carpeta-ddl" --unsafe --to-prod
```

## Orden de ejecucion

### `generate`

1. `reset schema` en scratch (`DROP SCHEMA ... CASCADE` + `CREATE SCHEMA`)
2. Ejecuta `pre_script/*`
3. Ejecuta DDL principal (con resolver `strict` o `smart`)
4. Compara target vs scratch con migra
5. Escribe `outputFile`

### `apply`

1. Ejecuta `pre_script/*` en target
2. Aplica `publicacion.sql` en transaccion
3. Ejecuta `post_script/*` en target

## Notas utiles

- La herramienta limpia BOM UTF-8 al leer SQL para evitar errores de sintaxis.
- Si tienes scripts `CREATE SEQUENCE` y tablas con `serial`/`serial4` que generan la misma secuencia, PostgreSQL puede crear nombres duplicados tipo `*_id_seq1`. Excluye esos scripts del DDL con `excludeDdlGlobs` (en el ejemplo se omite `secuencias/**`) o con `--exclude-ddl 'secuencias/**'`.
- Recomendado: revisar siempre `publicacion.sql` antes de ejecutar en produccion.

## Solucion de problemas rapida

- **`database "...scratch..." does not exist`**
  - Desde esta version, `generate` intenta crear la scratch automaticamente.
  - Si falla, revisa permisos del usuario para `CREATE DATABASE`.
- **`Migra detecto cambios destructivos`**
  - Reintenta con `--unsafe` si es intencional.
- **`No fue posible resolver dependencias automaticamente`**
  - Revisa precondiciones (`pre_script`) o dependencias ciclicas.
- **`function f_unaccent(text) does not exist`**
  - Asegura `CREATE EXTENSION IF NOT EXISTS unaccent;` en `pre_script`.

## Licencia y pruebas

- Licencia **MIT**: ver [LICENSE](LICENSE).
- Pruebas unitarias (sin PostgreSQL; Vitest, mocks de `pg` y migra): `npm test`.
- Cobertura al 100% sobre `src/*.js` excepto el wrapper `src/cli.js` (solo reexporta `runCli`): `npm run test:coverage`.
