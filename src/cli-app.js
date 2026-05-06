import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { generatePublication } from './generate.js';
import { applyPublicationAndPost } from './apply.js';
import { buildProdReleaseOutputPath } from './release-path.js';

/**
 * @returns {Command}
 */
export function createProgram() {
  const program = new Command();

  program
    .name('pg-ddl-publish')
    .description(
      'Compara DDL de una carpeta de .sql con PostgreSQL (scratch + migra), genera publicación y opcionalmente ejecuta post_script.',
    )
    .showHelpAfterError('(usa --help para ver opciones)');

  program
    .command('generate')
    .description(
      'Aplica los .sql al scratch, compara con la base objetivo y escribe el archivo de publicación.',
    )
    .requiredOption(
      '-f, --folder <path>',
      'Carpeta raíz con migraciones .sql (se excluye post_script/)',
    )
    .option(
      '-c, --config <path>',
      'JSON de configuración',
      path.resolve(process.cwd(), 'ddl-publish.config.json'),
    )
    .option('--target-url <url>', 'Sobrescribe URL base objetivo')
    .option('--scratch-url <url>', 'Sobrescribe URL base scratch')
    .option('--schema <name>', 'Esquema de aplicación (ej. bd_dental)')
    .option('--output <path>', 'Ruta del .sql generado')
    .option('--pre-script-dir <name>', 'Nombre de subcarpeta previa', 'pre_script')
    .option('--post-script-dir <name>', 'Nombre de subcarpeta reservada', 'post_script')
    .option(
      '--resolver <mode>',
      'Estrategia al ejecutar DDL en scratch: strict|smart',
      'smart',
    )
    .option(
      '--exclude-ddl <glob>',
      'Excluye del DDL principal (glob relativo a --folder); repetible',
      (value, previous) => previous.concat([value]),
      [],
    )
    .option(
      '--unsafe',
      'Permite que migra emita DROP u otras operaciones destructivas',
      false,
    )
    .option(
      '--to-prod, --toProd',
      'Escribe en <folder>/release/release_dd_MM_yyyy_HH_mm_ss.sql (anula --output)',
      false,
    )
    .action(async (opts) => {
      const cfg = await loadConfig(opts.config, {
        targetUrl: opts.targetUrl,
        scratchUrl: opts.scratchUrl,
        schema: opts.schema,
        preScriptDirName: opts.preScriptDir,
        postScriptDirName: opts.postScriptDir,
        excludeDdlGlobs: opts.excludeDdl,
        outputFile: opts.output,
        folder: opts.folder,
      });
      if (!cfg.folder) {
        throw new Error('generate requiere --folder o "folder" en el config.');
      }
      const outputFileAbs = opts.toProd
        ? buildProdReleaseOutputPath(cfg.folder)
        : cfg.outputFile;
      await generatePublication({
        folderAbs: cfg.folder,
        targetUrl: cfg.targetUrl,
        scratchUrl: cfg.scratchUrl,
        schema: cfg.schema,
        preScriptDirName: cfg.preScriptDirName,
        postScriptDirName: cfg.postScriptDirName,
        excludeDdlGlobs: cfg.excludeDdlGlobs,
        outputFileAbs,
        unsafe: opts.unsafe,
        resolver: opts.resolver === 'strict' ? 'strict' : 'smart',
      });
    });

  program
    .command('apply')
    .description(
      'Ejecuta el .sql de publicación en la base objetivo y luego todos los .sql en post_script/.',
    )
    .requiredOption('-f, --folder <path>', 'Misma carpeta raíz usada en generate (para post_script)')
    .requiredOption('-p, --publication <path>', 'Archivo .sql generado')
    .option(
      '-c, --config <path>',
      'JSON de configuración',
      path.resolve(process.cwd(), 'ddl-publish.config.json'),
    )
    .option('--target-url <url>', 'Sobrescribe URL base objetivo')
    .option('--schema <name>', 'Esquema de aplicación')
    .option('--pre-script-dir <name>', 'Nombre de subcarpeta previa', 'pre_script')
    .option('--post-script-dir <name>', 'Nombre de subcarpeta reservada', 'post_script')
    .action(async (opts) => {
      const cfg = await loadConfig(
        opts.config,
        {
          targetUrl: opts.targetUrl,
          schema: opts.schema,
          preScriptDirName: opts.preScriptDir,
          postScriptDirName: opts.postScriptDir,
          folder: opts.folder,
        },
        { requireScratch: false },
      );
      if (!cfg.folder) {
        throw new Error('apply requiere --folder o "folder" en el config.');
      }
      await applyPublicationAndPost({
        targetUrl: cfg.targetUrl,
        schema: cfg.schema,
        folderAbs: cfg.folder,
        preScriptDirName: cfg.preScriptDirName,
        postScriptDirName: cfg.postScriptDirName,
        publicationPathAbs: path.resolve(opts.publication),
      });
    });

  program
    .command('publish')
    .description('generate y apply en secuencia.')
    .requiredOption('-f, --folder <path>', 'Carpeta raíz con migraciones .sql')
    .option(
      '-c, --config <path>',
      'JSON de configuración',
      path.resolve(process.cwd(), 'ddl-publish.config.json'),
    )
    .option('--target-url <url>', 'Sobrescribe URL base objetivo')
    .option('--scratch-url <url>', 'Sobrescribe URL base scratch')
    .option('--schema <name>', 'Esquema de aplicación')
    .option('--output <path>', 'Ruta del .sql generado')
    .option('--pre-script-dir <name>', 'Nombre de subcarpeta previa', 'pre_script')
    .option('--post-script-dir <name>', 'Nombre de subcarpeta reservada', 'post_script')
    .option(
      '--resolver <mode>',
      'Estrategia al ejecutar DDL en scratch: strict|smart',
      'smart',
    )
    .option(
      '--exclude-ddl <glob>',
      'Excluye del DDL principal (glob relativo a --folder); repetible',
      (value, previous) => previous.concat([value]),
      [],
    )
    .option('--unsafe', 'Pasa --unsafe a migra', false)
    .option(
      '--to-prod, --toProd',
      'Escribe en <folder>/release/release_dd_MM_yyyy_HH_mm_ss.sql (anula --output)',
      false,
    )
    .action(async (opts) => {
      const cfg = await loadConfig(opts.config, {
        targetUrl: opts.targetUrl,
        scratchUrl: opts.scratchUrl,
        schema: opts.schema,
        preScriptDirName: opts.preScriptDir,
        postScriptDirName: opts.postScriptDir,
        excludeDdlGlobs: opts.excludeDdl,
        outputFile: opts.output,
        folder: opts.folder,
      });
      if (!cfg.folder) {
        throw new Error('publish requiere --folder o "folder" en el config.');
      }
      const outputFileAbs = opts.toProd
        ? buildProdReleaseOutputPath(cfg.folder)
        : cfg.outputFile;
      await generatePublication({
        folderAbs: cfg.folder,
        targetUrl: cfg.targetUrl,
        scratchUrl: cfg.scratchUrl,
        schema: cfg.schema,
        preScriptDirName: cfg.preScriptDirName,
        postScriptDirName: cfg.postScriptDirName,
        excludeDdlGlobs: cfg.excludeDdlGlobs,
        outputFileAbs,
        unsafe: opts.unsafe,
        resolver: opts.resolver === 'strict' ? 'strict' : 'smart',
      });
      await applyPublicationAndPost({
        targetUrl: cfg.targetUrl,
        schema: cfg.schema,
        folderAbs: cfg.folder,
        preScriptDirName: cfg.preScriptDirName,
        postScriptDirName: cfg.postScriptDirName,
        publicationPathAbs: outputFileAbs,
      });
    });

  return program;
}

/**
 * @param {string[]} [argv]
 */
export async function runCli(argv = process.argv) {
  const program = createProgram();
  await program.parseAsync(argv.slice(2), { from: 'user' });
}
