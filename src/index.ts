/**
 *
 * 1. when chokidar detects a file change,
 * 2. send "ssam:timelapse-changed" to client
 * 3. when client receives "ssam:timelapse-changed", it sends "ssam:timelapse-newframe" with canvas data url
 * 4. when plugin receives "ssam:timelapse-newframe", it will export an image
 *
 * TODO:
 * - if sketch results in error (ie. syntax), don't export a blank image?
 *   - listen to window.onerror
 * - use handleHotUpdate() to detect source code change instead of adding listener to the source itself?
 */

import { ViteDevServer } from "vite";
import chokidar from "chokidar";
import fs from "fs";
import path from "path";
import kleur from "kleur";
import ansiRegex from "ansi-regex";
import crypto from "crypto";

const { gray, green, yellow } = kleur;

type Options = {
  watchDir?: string;
  outDir?: string;
  overwrite?: boolean;
  stabilityThreshold?: number;
  padLength?: number;
  log?: boolean;
};

const defaultOptions = {
  watchDir: "./src",
  outDir: "./timelapse",
  overwrite: false,
  stabilityThreshold: 1500,
  padLength: 5,
  log: true,
};

const prefix = () => {
  return `${gray(new Date().toLocaleTimeString())} ${green(
    `[ssam-timelapse]`
  )}`;
};

const removeAnsiEscapeCodes = (str: string) => {
  return str.replace(ansiRegex(), "");
};

// it gets incremented to 0 right before saving file
let maxImageNumber = -1;
// store all file hashes in watchDir
let fileHashes: Record<string, any> = {};

export const ssamTimelapse = (opts?: Options) => ({
  name: "ssam-timelapse",
  configureServer(server: ViteDevServer) {
    const watchDir = opts?.watchDir || defaultOptions.watchDir;
    const outDir = opts?.outDir || defaultOptions.outDir;
    const overwrite = opts?.overwrite || defaultOptions.overwrite;
    const padLength = opts?.padLength || defaultOptions.padLength;
    const log = opts?.log || defaultOptions.log;
    const stabilityThreshold =
      opts?.stabilityThreshold || defaultOptions.stabilityThreshold;

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

    // watch for file changes in watchDir
    chokidar
      .watch(watchDir, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        ignoreInitial: true, // first loading
        awaitWriteFinish: {
          stabilityThreshold,
          pollInterval: 100,
        },
      })
      .on("all", (event, filePath, stats) => {
        // compare file hash to make sure file content really changed
        if (event === "add" || event === "change") {
          const absFilePath = path.resolve(filePath);
          const hash = crypto.createHash("sha256");
          const stream = fs.createReadStream(absFilePath);
          stream.on("data", (chunk) => {
            hash.update(chunk);
          });
          stream.on("end", () => {
            const newHashValue = hash.digest("hex");
            if (newHashValue !== fileHashes[absFilePath]) {
              fileHashes[absFilePath] = newHashValue;
              // if file change is detected, request canvas data to client
              server.ws.send("ssam:timelapse-changed");
            }
          });
        }
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
          log && client.send("ssam:log", { msg: removeAnsiEscapeCodes(msg) });
          console.log(msg);
        })
        .catch((err) => {
          const msg = `${prefix()} ${err}`;
          log && client.send("ssam:warn", { msg: removeAnsiEscapeCodes(msg) });
          console.error(`${prefix()} ${yellow(`${err}`)}`);
        });

      maxImageNumber = imageNumber;
    });
  },
});
