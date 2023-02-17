/**
 *
 * 1. when chokidar detects a file change,
 * 2. send "ssam:timelapse-changed" to client
 * 3. when client receives "ssam:timelapse-changed", it sends "ssam:timelapse-newframe" with canvas data url
 * 4. when plugin receives "ssam:timelapse-newframe", it will export an image
 *
 * TODO:
 * - when saving the unchanged file, "change" emits nonetheless due to metadata change. => compare file hash?
 * - if sketch results in error (ie. syntax), don't export a blank image?
 * - how to handle if canvas dimension changes? => maybe use ffmpeg afterwards
 * - use handleHotUpdate() to detect source code change instead of adding listener to the source itself?
 * - add console log for each image save?
 * - use Promise for writeFile
 */

import { ViteDevServer } from "vite";
import chokidar from "chokidar";
import fs from "fs";
import path from "path";
import kleur from "kleur";

const { gray, green, yellow } = kleur;

type Options = {
  watchDir?: string;
  outDir?: string;
  overwrite?: boolean;
  padLength?: number;
  incremental?: boolean;
  log?: boolean;
};

const defaultOptions = {
  watchDir: "./src",
  outDir: "./timelapse",
  overwrite: false,
  padLength: 5,
  incremental: false, // TODO: implementation
  log: true,
};

const prefix = () => {
  return `${gray(new Date().toLocaleTimeString())} ${green(
    `[ssam-timelapse]`
  )}`;
};

let maxImageNumber = -1;

export const ssamTimelapse = (opts?: Options) => ({
  name: "ssam-timelapse",
  configureServer(server: ViteDevServer) {
    const watchDir = opts?.watchDir || defaultOptions.watchDir;
    const outDir = opts?.outDir || defaultOptions.outDir;
    const overwrite = opts?.overwrite || defaultOptions.overwrite;
    const padLength = opts?.padLength || defaultOptions.padLength;
    const incremental = opts?.incremental || defaultOptions.incremental;
    const log = opts?.log || defaultOptions.log;

    // if outDir not exist, create one
    if (!fs.existsSync(outDir)) {
      fs.promises
        .mkdir(outDir)
        .then(() => {
          if (log) {
            const msg = `${prefix()} created a new directory at ${path.resolve(
              outDir
            )}`;
            console.log(msg);
          }
        })
        .catch((err) => {
          console.error(`${prefix()} ${yellow(`${err}`)}`);
        });
    } else {
      if (!overwrite) {
        // if outDir already exists, check for image files and max numbering
        fs.promises
          .readdir(outDir)
          .then((files) => {
            const images = files.filter((filename) =>
              filename.match(/\d+\.png/)
            );
            if (images.length !== 0) {
              const imageNumbers = images.map((filename) =>
                parseInt(filename, 10)
              );
              maxImageNumber = Math.max(...imageNumbers);
            }
          })
          .catch((err) => {
            console.error(`${prefix()} ${yellow(`${err}`)}`);
          });
      }
    }

    // TODO: if incremental, always create a new directory with outDir + datetime suffix

    // watch for file changes in watchDir
    chokidar
      .watch(watchDir, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 1000,
          pollInterval: 100,
        },
      })
      .on("change", (path, stats) => {
        // if file change is detected, request canvas data to client
        server.ws.send("ssam:timelapse-changed");
      });

    // when canvas data received, export an image
    server.ws.on("ssam:timelapse-newframe", (data, client) => {
      const buffer = Buffer.from(
        data.image.replace(/^data:image\/png;base64,/, ""),
        "base64"
      );

      const imageNumber = maxImageNumber + 1;
      const filename = `${imageNumber.toString().padStart(padLength, "0")}.png`;

      fs.promises
        .writeFile(path.join(outDir, filename), buffer)
        .then(() => {
          const msg = `${prefix()} ${filename} exported`;
          client.send("ssam:log", { msg });
          console.log(msg);
        })
        .catch((err) => {
          const msg = `${prefix()} ${err}`;
          client.send("ssam:warn", { msg });
          console.error(`${prefix()} ${yellow(`${err}`)}`);
        });

      maxImageNumber = imageNumber;
    });
  },
});
