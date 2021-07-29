import fs from 'fs';
import nodePath from 'path';
import nodeWatch from 'node-watch';
import { Command } from 'commander';
import { Partitioner, CONTENT_TYPES } from './partition-content.mjs';
import { repr, PathInfo } from '../utils.js';

// When running `gridsome build` or `develop`, links are sufficient for it to do the right thing
// (except in the case of `vue-remark`, of course).
const PREPROCESS_PLACERS = {md:'link', vue:'copy', insert:'link', resource:'link'};
// But the development server's hot reloader doesn't deal well with links. When the target of a link
// has been edited, it notices and does some work, but ultimately doesn't recompile the page.
// Even worse, if a link is ever broken, it crashes.
const WATCH_PLACERS = {md:'copy', vue:'copy', insert:'copy', resource:'copy'};

// Define command line arguments.
let program = new Command();
program
  .description(
    "Process the files in the content directory and set up the build directories so they're ready\n"
    +"for Gridsome."
  )
  .argument(
    '[command]',
    'Action to take:\n'
      +"'preprocess': Just do a one-time setup of the build directories, then exit.\n"
      +"'watch': Watch the content directory and keep it in sync with the build directories. "
               +"This does not do any preprocessing! You must make sure the content and build"
               +"directories are already synced!"
  )
  .option(
    '-C, --no-clear',
    "Don't empty the build directories first. By default, this deletes everything in the build "
    +'directories before preprocessing. This has no effect if only watching, as no clearing is '
    +'ever done in that case.',
  )
  .option(
      '-p, --placer <name>',
      `Method of placing Markdown files into the build directories:
                     'link': Link to the original file from the build directory.
                     'copy': Place a copy of the original file in the build directory.`
  )
  .option('-v, --verbose', 'Output only warnings and errors.')
  .option('-n, --simulate', 'Do not make any actual changes to the filesystem.')
  .option('--debug', 'Print debug output.')
  .action(main);

for (let contentType of CONTENT_TYPES) {
  program = program.option(
    `--${contentType} <name>`,
    repr`Set the method of placing ${contentType} files. Overrides default --placer.`
  );
}
program.parse(process.argv);


function main(command, opts) {
  // Check if command is valid.
  if (['preprocess', 'watch'].indexOf(command) === -1) {
    let preamble;
    if (command) {
      preamble = repr`Invalid command ${command}. `;
    } else {
      preamble = 'No command given. ';
    }
    console.error(preamble+"Must choose 'preprocess' or 'watch'.");
    process.exit(1);
  }
  // Assign placers.
  let placers = {};
  if (command === 'preprocess') {
    Object.assign(placers, PREPROCESS_PLACERS);
  } else if (command === 'watch') {
    Object.assign(placers, WATCH_PLACERS);
  }
  for (let contentType of CONTENT_TYPES) {
    if (opts[contentType]) {
      placers[contentType] = opts[contentType];
    }
  }
  // Create Partitioner.
  let partitioner = new Partitioner(
    {simulate:opts.simulate, verbose:opts.verbose, placer:opts.placer, placers:placers}
  );
  // Execute command.
  if (command === 'watch') {
    function handleEvent(eventType, path) {
      partitioner.handleEvent(eventType, path);
    }
    let watcher = nodeWatch(partitioner.contentDir, {recursive:true}, handleEvent);
    //TODO: Wait for a gridsome develop process to appear, then exit once it dies.
  } else if (command === 'preprocess') {
    doPrePartitioning(partitioner, opts.clear, partitioner.simulate, partitioner.verbose);
    partitioner.placeDirFiles(partitioner.contentDir, true);
  }
}


function doPrePartitioning(config, clear, simulate, verbose) {
  setupBuildDirs(config.buildDirs, clear, simulate, verbose);
  linkStaticImages(config.projectRoot, config.contentDir, simulate, verbose);
}

function setupBuildDirs(buildDirs, clear, simulate, verbose) {
  for (let dirPath of Object.values(buildDirs)) {
    if (clear) {
      if (verbose) {
        console.log(repr`Clearing out existing files in build directory ${dirPath}`);
      }
      if (! simulate) {
        fs.rmSync(dirPath, {recursive:true});
      }
    }
    if (! simulate) {
      fs.mkdirSync(dirPath, {recursive:true});
    }
  }

}

function linkStaticImages(projectRoot, contentDir, simulate, verbose) {
  let linkPath = nodePath.join(projectRoot, 'static/images');
  let targetPath = nodePath.join(contentDir, 'images');
  let relativePath = nodePath.relative(nodePath.dirname(linkPath), targetPath);
  let linkInfo = new PathInfo(linkPath);
  if (linkInfo.exists()) {
    if (linkInfo.isLink()) {
      let existingRelativePath = fs.readlinkSync(linkPath);
      if (relativePath === existingRelativePath) {
        if (verbose) {
          console.log(repr`Static images link already exists.`);
        }
        return;
      } else {
        console.log(repr`Static images link already exists but is wrong: ${existingRelativePath}`);
        if (! simulate) {
          fs.unlinkSync(linkPath);
        }
      }
    } else {
      throw repr`Path already exists but is not a symlink: ${linkPath}`;
    }
  }
  if (verbose) {
    console.log(repr`Linking to ${relativePath} from ${linkPath}..`);
  }
  if (! simulate) {
    fs.symlinkSync(relativePath, linkPath);
  }
}
