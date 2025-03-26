importScripts(
  "demuxer_mp4.js", // 비디오 디코더
  "renderer_2d.js", // 2D 렌더러
  "renderer_webgl.js", // WebGL 렌더러
  "renderer_webgpu.js" // WebGPU 렌더러
);

let pendingStatus = null;

// 재생 제어 상태
let isPlaying = true;
let timeoutId = null;
let renderer = null;
let pendingFrame = null;
let startTime = null;
let frameCount = 0;
let lastFrameTime = 0;
let playbackSpeed = 1;
let decoder = null;

function setStatus(type, message) {
  if (pendingStatus) {
    pendingStatus[type] = message;
  } else {
    pendingStatus = { [type]: message };
    self.requestAnimationFrame(statusAnimationFrame);
  }
}

function statusAnimationFrame() {
  self.postMessage(pendingStatus);
  pendingStatus = null;
}

function renderFrame(frame) {
  if (!pendingFrame) {
    requestAnimationFrame(renderAnimationFrame);
  } else {
    pendingFrame.close();
  }
  pendingFrame = frame;
}

function renderAnimationFrame() {
  renderer.draw(pendingFrame);
  pendingFrame = null;
}

function renderAtCorrectTime(frame) {
  if (!isPlaying) {
    frame.close();
    return;
  }

  const now = performance.now();
  if (startTime === null) {
    startTime = now - frame.timestamp / 1000 / playbackSpeed;
  }

  const elapsed = now - startTime;
  const frameTime = frame.timestamp / 1000 / playbackSpeed;
  const delay = Math.max(0, frameTime - elapsed);

  frame.caption = `PTS: ${parseInt(frame.timestamp / 1_000_000)}초`;

  timeoutId = setTimeout(() => {
    if (isPlaying) {
      renderFrame(frame);
      lastFrameTime = frame.timestamp;
    } else {
      frame.close();
    }
  }, delay);
}

function handleStart({ dataUri, rendererName, canvas }) {
  console.log("Starting", rendererName, "renderer");

  switch (rendererName) {
    case "2d":
      renderer = new Canvas2DRenderer(canvas);
      break;
    case "webgl":
    case "webgl2":
      renderer = new WebGLRenderer(rendererName, canvas);
      break;
    case "webgpu":
      renderer = new WebGPURenderer(canvas);
      break;
  }

  decoder = new VideoDecoder({
    output(frame) {
      if (startTime === null) {
        startTime = performance.now();
      } else {
        const elapsed = (performance.now() - startTime) / 1000;
        const fps = ++frameCount / elapsed;
        setStatus("render", `${fps.toFixed(0)} fps`);
      }

      renderAtCorrectTime(frame);
    },
    error(e) {
      setStatus("decode", e);
    },
  });

  const demuxer = new MP4Demuxer(dataUri, {
    onConfig(config) {
      setStatus(
        "decode",
        `${config.codec} @ ${config.codedWidth}x${config.codedHeight}`
      );
      decoder.configure(config);
    },
    onChunk(chunk) {
      decoder.decode(chunk);
    },
    setStatus,
  });
}

function play() {
  if (!isPlaying) {
    isPlaying = true;
    startTime = performance.now() - lastFrameTime / 1000 / playbackSpeed;
  }
}

function pause() {
  isPlaying = false;
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

// ✅ 메시지 처리기 (모든 명령 지원)
self.addEventListener("message", (event) => {
  const { type, ...data } = event.data;
  console.log(type);
  console.log(data);
  switch (type) {
    case "start":
      handleStart({
        dataUri: data.dataUri,
        rendererName: data.rendererName,
        canvas: data.canvas,
      });
      break;
    case "play":
      play();
      break;
    case "pause":
      pause();
      break;
  }
});
