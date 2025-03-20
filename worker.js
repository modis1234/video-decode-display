importScripts(
  "demuxer_mp4.js", // 비디오 디코더
  "renderer_2d.js", // 2D 렌더러
  "renderer_webgl.js", // WebGL 렌더러
  "renderer_webgpu.js" // WebGPU 렌더러
);

let pendingStatus = null;
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

let renderer = null;
let firstFrameRendered = false;
let isPlaying = false;
let pendingChunks = [];
let decoder = null;
let frameCount = 0; // 프레임 카운트

let startTime = null;

function start({ dataUri, rendererName, canvas }) {
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
      // console.log("output--->", frame);
      // 디코딩된 프레임을 처리하고 FPS를 업데이트
      if (startTime == null) {
        startTime = performance.now(); // 첫 번째 프레임의 시간 기록
      } else {
        const elapsed = (performance.now() - startTime) / 1000; // 경과 시간 (초)
        const fps = ++frameCount / elapsed; // FPS 계산
        setStatus("render", `${fps.toFixed(0)} fps`); // FPS 상태 업데이트
      }
      if (!firstFrameRendered) {
        renderer.draw(frame);
        firstFrameRendered = true;
        setStatus("status", "First frame rendered. Click play to continue.");
      } else {
        pendingChunks.push(frame);
      }
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
      if (!firstFrameRendered) {
        decoder.decode(chunk);
      } else {
        pendingChunks.push(chunk);
      }
    },
    setStatus,
  });
}

let playbackSpeed = 1; // 기본 1배속

let playTimeOutId = null;

function playFrames() {
  if (isPlaying || pendingChunks.length === 0) return;
  isPlaying = true;

  function renderLoop() {
    if (!isPlaying || pendingChunks.length === 0) {
      isPlaying = false;
      return;
    }

    const frame = pendingChunks.shift();

    const now = performance.now();
    const elapsed = (now - startTime) / 1000; // 초 단위 변환
    const frameTime = frame.timestamp / 1_000_000; // PTS(초 단위 변환)

    const adjustedFrameTime = frameTime / playbackSpeed; // 재생 속도 적용된 시간
    const delay = Math.max(0, (adjustedFrameTime - elapsed) * 1000); // 밀리초 변환
    // console.log(`PTS: ${parseInt(frame.timestamp / 1_000_000)}초`);
    console.log("delay-->", delay);

    frame.caption = `PTS: ${parseInt(frame.timestamp / 1_000_000)}초`;

    renderer.draw(frame);
    frame.close();

    setTimeout(() => {
      requestAnimationFrame(renderLoop);
    }, delay);

    // requestAnimationFrame(renderLoop);
  }

  renderLoop();
}

function pauseFrames() {
  isPlaying = false;
}

function setPlaybackSpeed(speed) {
  pauseFrames();
  playbackSpeed = speed;
  playFrames();
  console.log("speed-->", speed);
}

self.addEventListener("message", (message) => {
  const { type, ...data } = message.data;
  if (type === "start") start(data);
  else if (type === "play") playFrames();
  else if (type === "pause") pauseFrames();
  else if (type === "playbackRate") setPlaybackSpeed(data?.rate || 1);
});
