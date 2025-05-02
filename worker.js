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
  try {
    self.postMessage(pendingStatus);
  } catch (e) {
    console.warn("⚠️ Failed to postMessage in Worker:", e);
  }
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

let isFullscreen = false; // 전체 화면 여부

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
        frame.close();

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

function start({ dataUri, rendererName, canvas, textCanvas, mosaicCanvas }) {
  switch (rendererName) {
    case "2d":
      renderer = new Canvas2DRenderer(canvas);
      break;
    case "webgl":
    case "webgl2":
      renderer = new WebGLRenderer(
        rendererName,
        canvas,
        textCanvas,
        mosaicCanvas
      );
      break;
    case "webgpu":
      renderer = new WebGPURenderer(canvas);
      break;
  }

  dataUri = dataUri;

  // ✅ 비디오 디코더 생성
  createDecoder(); // 디코더 생성

  // ✅ 렌더러 생성
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

  console.log("result.length-->", result.length);
  console.log("result-->", result);
  renderer.setTrackData(result); // 트랙 데이터 설정

  const reduceList = result.reduce((acc, cur) => {
    const { index, timestamp } = cur;
    const diffTimestamp = timestamp.toFixed(1);

    const hasTimestamp = acc?.[index]?.some(
      (item) => item.timestamp.toFixed(1) === diffTimestamp
    );
    if (hasTimestamp) {
      // console.log("hasTimestamp-z->", hasTimestamp);
      return acc;
    }
    if (acc?.[index]) {
      acc[index].push(cur);
    } else {
      acc = {
        ...acc,
        [index]: [cur],
      };
    }
    return acc;
  }, {});

  setStatus("trackData", reduceList); // 트랙 데이터 설정

  // return result;
}

let playbackSpeed = 1; // 기본 1배속

let playTimeOutId = null;

function playFrames() {
  if (isPlaying || pendingChunks.length === 0) return;
  isPlaying = true;

  startTime = performance.now() - lastFrameTime / 1000;

  async function renderLoop() {
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

    setStatus("videoTime", elapsed); // FPS 상태 업데이트
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

  const clampedTime = Math.max(0, Math.min(lastFrameTimeStamp, timeInMs)); // 0과 lastFrameTimeStamp 사이의 값으로 클램핑

  currentTimeStamp = timeInMs === 0 ? 0 : clampedTime; // 밀리초 단위로 변환
  // 4. 시킹
  demuxer.seek(currentTimeStamp); // 마이크로초 단위로 변환
}

// fullScreen 설정
function fullScreenAction(width, height) {
  // if (isPlaying) {
  //   pauseFrames(); // 일시 정지 상태로 변경
  // }
  console.log("fullScreenAction-->", isFullscreen);
  renderer?.resize(width, height, isFullscreen);
  // setTimeout(() => {
  //   playFrames(); // 재생 상태로 변경
  // }, 100); // 1초 후에 재생 시작
}

function rectClickAction(x, y) {
  if (isPlaying) {
    renderer.handleClick(x, y);
  } else {
    renderer.handlePauseClick(x, y); // pause 상태 클릭 이벤트 처리
  }
}

function rectMouseMoveAction(x, y) {
  const _isMouseArea = renderer?.handleMouseMove(x, y) || false; // hover 상태 클릭 이벤트 처리
  const _getCursor = renderer?.getResizeCursor(x, y) || "default"; // hover 상태 클릭 이벤트 처리

  setStatus("getCursor", _getCursor); // hover 상태 업데이트
}

function rectMouseDownAction(x, y) {
  renderer?.handleMouseDown(x, y); // mouse down 상태 클릭 이벤트 처리
}
function rectMouseUpAction(x, y) {
  renderer?.handleMouseUp(x, y); // mouse up 상태 클릭 이벤트 처리
}

function zoneSettingAction() {
  renderer?.zoneSetting(); // zone setting 상태 클릭 이벤트 처리
}

function setTextAction(text) {
  console.log("text-->", text);
  // renderer?.setText(text); // zone setting 상태 클릭 이벤트 처리
}

self.addEventListener("message", (message) => {
  const { type, ...data } = message.data;
  if (type === "start") {
    const { csvData, ...rest } = data;
    videoData = rest;
    console.log("videoData-->", rest);
    start(rest);
    parseCSVToJson(data.csvData);
  } else if (type === "play") playFrames();
  else if (type === "pause") pauseFrames();
  else if (type === "playbackRate") setPlaybackSpeed(data?.rate || 1);
  else if (type === "seekForward")
    seekTo(currentTimeStamp + 10); // 10초 앞으로 이동
  else if (type === "seekBackward")
    seekTo(currentTimeStamp - 10); // 10초 뒤로 이동
  else if (type === "reset") seekTo(0); // WebCodecs 리셋
  else if (type === "rectClick")
    rectClickAction(data?.clickX, data?.clickY); // 클릭 이벤트 처리
  else if (type === "rectMouseMove")
    rectMouseMoveAction(data?.mouseX, data?.mouseY); // 마우스 호버 이벤트 처리
  else if (type === "rectMouseDown")
    rectMouseDownAction(data?.mouseX, data?.mouseY); // 마우스 다운 이벤트 처리
  else if (type === "rectMouseUp")
    rectMouseUpAction(data?.mouseX, data?.mouseY); // 마우스 업 이벤트 처리
  else if (type === "zoneSetting")
    zoneSettingAction(); // zone setting 이벤트 처리
  else if (type === "setText")
    setTextAction(data?.text); // zone setting 이벤트 처리
  else if (type === "seekAction") {
    seekTime = data?.seekTime || 0; // seekTime 설정
    seekTo(seekTime); // seekTo 호출
  } else if (type === "resizeAction") {
    console.log("resize-->", data);
    isFullscreen = data?.isFullscreen || false; // 전체 화면 여부 설정
    fullScreenAction(data.width, data.height); // fullScreenAction 호출
  } else {
    console.warn(`⚠️ Unknown message type received: ${type}`);
  }
});
