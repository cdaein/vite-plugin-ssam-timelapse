# vite-plugin-ssam-timelapse

This plugin is created to be used with [Ssam](https://github.com/cdaein/ssam) to capture in-progress images of a Canvas sketch. It may also be used in other cases.

## Install

```sh
npm i -D vite-plugin-ssam-timelapse
```

## How it works

When the plugin detects a change in the sketch source code, it will export a PNG image with sequential numbering. You can later convert the resulting image sequence into a video to document your visual progress.

## How to use

In Vite config:

```js
import { ssamTimelapse } from "vite-plugin-ssam-timelapse";

export default defineConfig({
  plugins: [ssamTimelapse()],
  // ...
});
```

In your Ssam sketch source code:

```js
import { ssam } from "ssam";

const sketch = ({ wrap, canvas }) => {
  if (import.meta.hot) {
    import.meta.hot.on("ssam:timelapse-changed", () => {
      import.meta.hot?.send("ssam:timelapse-newframe", {
        image: canvas.toDataURL(),
      });
    });
  }

  wrap.render = () => {
    // your drawing code
  };
};

const settings = {
  dimensions: [800, 800],
};

ssam(sketch, settings);
```

## Vanilla JS Example

```js
const canvas = document.createElement("canvas");
canvas.width = canvas.height = 600;
document.body.appendChild(canvas);
const ctx = canvas.getContext("2d")!;

// make changes to drawing code and save
ctx.fillStyle = `gray`;
ctx.fillRect(0, 0, 600, 600);
ctx.beginPath();
ctx.arc(300, 300, 300, 0, Math.PI * 2);
ctx.fillStyle = `white`;
ctx.fill();

// at each save, canvas image will be exported
if (import.meta.hot) {
  import.meta.hot.on("ssam:timelapse-changed", () => {
    import.meta.hot?.send("ssam:timelapse-newframe", {
      image: canvas.toDataURL(),
    });
  });
}
```

## Default Options

```js
ssamTimelapse({
  watchDir: "./src", // detect changes in the src directory
  outDir: "./timelapse", // will create the directory if it does not exist
  overwrite: false, // overwrite existing files
  padLength: 5, // how many zeros to pad to filename
});
```

## Convert to MP4

Use a video editing program to convert the image sequence into a video file. If you have `ffmpeg` installed, it is as simple as running the following command:

```sh
ffmpeg -framerate 5 -pattern_type glob -i '*.png' -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -y output.mp4
```

Note that `ffmpeg` expects the filenames are sequential. If you delete files from the image sequence, you will need to rename them before running the ffmpeg command.

## License

MIT
