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
let lastKnownConfig = null;

let frameCount = 0; // 프레임 카운트
let lastFrameTime = 0; // 마지막 프레임 시간
let startTime = null;
let timeoutId = null; // 타임아웃 ID
let videoData = null; // 비디오 데이터
let demuxer = null;
let dataUri = null;

let currentTimeStamp = 0; // 현재 시간 PTS
let lastFrameTimeStamp = 0; // 마지막 프레임 시간 PTS

let seekTime = 0; // 시간 이동

// Decoder 초기화
function createDecoder() {
  if (decoder && decoder.state !== "closed") {
    decoder.close();
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
        frame.caption = `PTS: ${parseInt(frame.timestamp / 1_000_000)}초`;

        renderer.draw(frame);
        lastFrameTime = frame.timestamp;
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
}

function start({ dataUri, rendererName, canvas, textCanvas }) {
  switch (rendererName) {
    case "2d":
      renderer = new Canvas2DRenderer(canvas);
      break;
    case "webgl":
    case "webgl2":
      renderer = new WebGLRenderer(rendererName, canvas, textCanvas);
      break;
    case "webgpu":
      renderer = new WebGPURenderer(canvas);
      break;
  }

  dataUri = dataUri;

  // ✅ 비디오 디코더 생성
  createDecoder(); // 디코더 생성

  demuxer = new MP4Demuxer(dataUri, {
    onConfig(config) {
      setStatus(
        "decode",
        `${config.codec} @ ${config.codedWidth}x${config.codedHeight}`
      );
      lastKnownConfig = config; // 🔹 저장
      decoder.configure(config);
    },
    onChunk(chunk) {
      const frameTime = chunk.timestamp / 1_000_000; // PTS(초 단위 변환)
      lastFrameTimeStamp = frameTime; // 마지막 프레임 시간 저장
      console.log("lastFrameTimeStamp-->", lastFrameTimeStamp);
      if (!firstFrameRendered) {
        decoder.decode(chunk);
      } else {
        pendingChunks.push(chunk);
      }
    },
    setStatus,
  });
}

// CSV 데이터를 JSON으로 변환하는 함수
function parseCSVToJson(csv) {
  const result = [];

  csv.forEach((csvItem) => {
    const rows = csvItem.trim().split("\n"); // 각 행을 배열로 분리
    rows.forEach((row) => {
      const columns = row.split(","); // 각 열을 쉼표로 분리
      result.push({
        frame: parseFloat(columns[0]),
        timestamp: parseFloat(columns[1]),
        type: parseInt(columns[2], 10),
        index: parseInt(columns[3], 10),
        x1: parseFloat(columns[4]),
        y1: parseFloat(columns[5]),
        x2: parseFloat(columns[6]),
        y2: parseFloat(columns[7]),
      });
    });
  });

  // console.log("result-->", result);
  renderer.setTrackData(result); // 트랙 데이터 설정
  // return result;
}

let playbackSpeed = 1; // 기본 1배속

let playTimeOutId = null;

function playFrames() {
  if (isPlaying || pendingChunks.length === 0) return;
  isPlaying = true;

  startTime = performance.now() - lastFrameTime / 1000;

  function renderLoop() {
    if (!isPlaying || pendingChunks.length === 0) {
      isPlaying = false;
      return;
    }
    const frame = pendingChunks.shift();
    const now = performance.now();
    const elapsed = (now - startTime) / 1000; // 초 단위로 변환
    const frameTime = frame.timestamp / 1_000_000; // PTX(초 단위 변환)
    const adjustedFrameTime = frameTime / playbackSpeed; // 재생 속도 적용된 시간

    let delay = Math.max(16, (adjustedFrameTime - elapsed) * 1000); // 밀리초 변환- 최소 16ms 보장
    frame.caption = `PTS: ${parseInt(frame.timestamp / 1_000_000)}초`;
    frame.playbackSpeed = playbackSpeed;
    renderer.draw(frame);
    frame.close();

    timeoutId = setTimeout(() => {
      requestAnimationFrame(renderLoop);
      lastFrameTime = frame.timestamp;
      currentTimeStamp = frameTime; // 현재 시간 저장
    }, delay);
  }

  setTimeout(renderLoop, 100); // 초기 실행 지연 (100ms)
}

function pauseFrames() {
  isPlaying = false;
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function setPlaybackSpeed(speed) {
  pauseFrames();
  playbackSpeed = speed;
  playFrames();
}

// seekTime을 설정하는 함수
function seekTo(timeInMs) {
  if (decoder) {
    decoder.close();
  }

  // 1. 디코더 재생성
  createDecoder();
  // 2. 디코더 구성
  decoder.configure(lastKnownConfig); // 저장해둔 VideoDecoderConfig 사용
  // 3. 상태 초기화
  pendingChunks = [];
  firstFrameRendered = false;

  const clampedTime = Math.max(
    0,
    Math.min(lastFrameTimeStamp, currentTimeStamp + timeInMs)
  ); // 0과 lastFrameTimeStamp 사이의 값으로 클램핑

  currentTimeStamp = timeInMs === 0 ? 0 : clampedTime; // 밀리초 단위로 변환

  // 4. 시킹
  demuxer.seek(currentTimeStamp); // 마이크로초 단위로 변환
  lastFrameTimeStamp;
  console.log("isPlaying->", isPlaying);
}

self.addEventListener("message", (message) => {
  const { type, ...data } = message.data;
  console.log("type->", type);
  if (type === "start") {
    const { csvData, ...rest } = data;
    videoData = rest;
    start(rest);
    parseCSVToJson(data.csvData);
  } else if (type === "play") playFrames();
  else if (type === "pause") pauseFrames();
  else if (type === "playbackRate") setPlaybackSpeed(data?.rate || 1);
  else if (type === "seekForward") seekTo(10); // 10초 앞으로 이동
  else if (type === "seekBackward") seekTo(-10); // 10초 뒤로 이동
  else if (type === "reset") seekTo(0); // WebCodecs 리셋
});
