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
let lastFrameTime = 0; // 마지막 프레임 시간
let startTime = null;
let timeoutId = null; // 타임아웃 ID
let videoData = null; // 비디오 데이터
let demuxer = null;

let seekTime = 0; // 시간 이동

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
        const frameTime = frame.timestamp / 1_000_000; // PTS(초 단위 변환)
        console.log("seekTime->", seekTime);
        // 🎯 **10초 이전 프레임은 무시하고 바로 해제**
        if (frameTime < seekTime) {
          console.log(`Skipping frame at ${frameTime}초`);
          frame.close(); // 메모리 해제
          return;
        }

        pendingChunks.push(frame);
      }
    },
    error(e) {
      setStatus("decode", e);
    },
  });

  demuxer = new MP4Demuxer(dataUri, {
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

  startTime = performance.now() - lastFrameTime / 1000;
  console.log("startTime-->", startTime);
  console.log("pendingChunks-->", pendingChunks);
  function renderLoop() {
    if (!isPlaying || pendingChunks.length === 0) {
      isPlaying = false;
      return;
    }

    const frame = pendingChunks.shift();

    const now = performance.now();
    const elapsed = (now - startTime) / 1000; // 초 단위 변환
    const frameTime = frame.timestamp / 1_000_000; // PTS(초 단위 변환)

    const adjustedFrameTime = frameTime / playbackSpeed - 10; // 재생 속도 적용된 시간
    console.log("adjustedFrameTime-->", adjustedFrameTime);

    const delay = Math.max(0, (adjustedFrameTime - elapsed) * 1000); // 밀리초 변환
    // console.log(`PTS: ${parseInt(frame.timestamp / 1_000_000)}초`);
    console.log("delay-->", delay);

    frame.caption = `PTS: ${parseInt(frame.timestamp / 1_000_000)}초`;
    frame.playbackSpeed = playbackSpeed;
    renderer.draw(frame);
    frame.close();

    timeoutId = setTimeout(() => {
      requestAnimationFrame(renderLoop);
      lastFrameTime = frame.timestamp;
    }, delay);

    // requestAnimationFrame(renderLoop);
  }

  renderLoop();
}

function pauseFrames() {
  isPlaying = false;
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }

  // pendingChunks.forEach((frame) => frame.close());
  // pendingChunks = [];
}

function setPlaybackSpeed(speed) {
  pauseFrames();
  playbackSpeed = speed;
  playFrames();
  console.log("speed-->", speed);
}

// 10초 앞으로 이동
function seekForward(timeInSeconds) {
  if (isPlaying) {
    pauseFrames();
  }

  // 새로운 프레임 시간 설정
  seekTime = timeInSeconds;

  // decoder를 리셋하고, 새로운 시작점을 설정
  decoder.reset(); // 이전 상태를 리셋
  pendingChunks = []; // 기존 청크 데이터 초기화

  // Seek에 해당하는 위치부터 디코딩 시작
  // setStatus("status", `Seeking to ${seekTime}s...`);
  // demuxer.seek(timeInSeconds); // Demuxer에 seek 요청
}

// 10초 뒤로 이동
function seekBackward() {
  if (isPlaying) {
    pauseFrames();
  }
  const newTime = Math.max(0, lastFrameTime / 1000 - 10); // 10초 뒤로 이동, 0초 미만으로 가지 않도록 처리
  startTime = performance.now() - newTime * 1000; // 새로운 위치에 맞게 startTime 업데이트
  setStatus("status", "10초 뒤로 이동 중...");
  playFrames(); // 새로운 위치에서 재생 시작
}

self.addEventListener("message", (message) => {
  const { type, ...data } = message.data;
  console.log("type`-->", type);

  if (type === "start") {
    start(data);
    videoData = data;
  } else if (type === "play") playFrames();
  else if (type === "pause") pauseFrames();
  else if (type === "playbackRate") setPlaybackSpeed(data?.rate || 1);
  else if (type === "seekForward") seekForward(10); // 10초 앞으로 이동
  else if (type === "seekBackward") seekBackward(); // 10초 뒤로 이동
});
