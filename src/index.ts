/**
 *
 * 1. when chokidar detects a file change,
 * 2. send "ssam:timelapse-changed" to client
 * 3. when client receives "ssam:timelapse-changed", it sends "ssam:timelapse-newframe" with canvas data url
 * 4. when plugin receives "ssam:timelapse-newframe", it will export an image
 *
 * TODO:
 * - opts.mode: "save" | "interval"
 *   - at each save
 *   - at fixed interval
 * - if sketch results in error (ie. syntax), don't export a blank image?
 *   - listen to window.onerror
 * - use handleHotUpdate() to detect source code change instead of adding listener to the source itself?
 */

import type { PluginOption, ViteDevServer } from "vite";
import chokidar from "chokidar";
import fs from "node:fs";
import path from "node:path";
import ansiRegex from "ansi-regex";
import { createHash } from "node:crypto";
import { color } from "./utils";

type Options = {
  /** directory to watch for */
  watchDir?: string;
  /** directory to save images to */
  outDir?: string;
  /** overwrite existing images */
  overwrite?: boolean;
  /** files, directories to ignore */
  ignored?: string | string[] | RegExp;
  /** how quickly to respond to change (in milliseconds) */
  stabilityThreshold?: number;
  /** how many preceding zeros to pad to filenames */
  padLength?: number;
  /** console logging in browser */
  log?: boolean;
};

const defaultOptions = {
  watchDir: "./src",
  outDir: "./timelapse",
  overwrite: false,
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  stabilityThreshold: 10_000,
  padLength: 5,
  log: true,
};

const prefix = () => {
  return `${color(new Date().toLocaleTimeString(), "gray")} ${color(
    `[ssam-timelapse]`,
    "green",
  )}`;
};

const removeAnsiEscapeCodes = (str: string) => {
  return str.replace(ansiRegex(), "");
};

// it gets incremented to 0 right before saving file
let maxImageNumber = -1;
// store all file hashes in watchDir
let fileHashes: Record<string, any> = {};

export const ssamTimelapse = (opts: Options = {}): PluginOption => ({
  name: "vite-plugin-ssam-timelapse",
  apply: "serve", // plugin only works for development
  configureServer(server: ViteDevServer) {
    // update defaultOptions with user-provided options
    const {
      watchDir,
      outDir,
      overwrite,
      ignored,
      padLength,
      log,
      stabilityThreshold,
    } = Object.assign(defaultOptions, opts);

    // if outDir not exist, create one
    if (!fs.existsSync(outDir)) {
      fs.promises
        .mkdir(outDir)
        .then(() => {
          const msg = `${prefix()} created a new directory at ${path.resolve(
            outDir,
          )}`;
          console.log(msg);
        })
        .catch((err) => {
          console.error(`${prefix()} ${color(`${err}`, "yellow")}`);
        });
    } else {
      if (!overwrite) {
        // if outDir already exists, check for image files and max numbering
        fs.promises
          .readdir(outDir)
          .then((files) => {
            const images = files.filter((filename) =>
              filename.match(/\d+\.png/),
            );
            if (images.length !== 0) {
              const imageNumbers = images.map((filename) =>
                parseInt(filename, 10),
              );
              maxImageNumber = Math.max(...imageNumbers);
            }
          })
          .catch((err) => {
            console.error(`${prefix()} ${color(`${err}`, "yellow")}`);
          });
      }
    }

    const handleAddOrChange = (filePath: string, stats?: fs.Stats) => {
      // exclude empty file
      if (stats && stats.size === 0) return;

      // compare file hash to make sure file content really changed
      const absFilePath = path.resolve(filePath);
      const hash = createHash("sha256");
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
    };

    // watch for file changes in watchDir
    chokidar
      .watch(watchDir, {
        ignored,
        ignoreInitial: true, // first loading
        awaitWriteFinish: {
          stabilityThreshold,
          pollInterval: 100,
        },
      })
      .on("add", handleAddOrChange)
      .on("change", handleAddOrChange);

    // when canvas data received, export an image
    server.ws.on("ssam:timelapse-newframe", (data, client) => {
      const buffer = Buffer.from(
        data.image.replace(/^data:image\/png;base64,/, ""),
        "base64",
      );

      const imageNumber = maxImageNumber + 1;
      const filename = `${imageNumber.toString().padStart(padLength, "0")}.png`;
      const filePath = path.join(outDir, filename);

      fs.promises
        .writeFile(filePath, buffer)
        .then(() => {
          const msg = `${prefix()} ${filePath} exported`;
          log && client.send("ssam:log", { msg: removeAnsiEscapeCodes(msg) });
          console.log(msg);
        })
        .catch((err) => {
          const msg = `${prefix()} ${err}`;
          log && client.send("ssam:warn", { msg: removeAnsiEscapeCodes(msg) });
          console.error(`${prefix()} ${color(`${err}`, "yellow")}`);
        });

      maxImageNumber = imageNumber;
    });
  },
});
