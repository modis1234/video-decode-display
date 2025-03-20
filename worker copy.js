importScripts(
  "demuxer_mp4.js", // 비디오 디코더
  "renderer_2d.js", // 2D 렌더러
  "renderer_webgl.js", // WebGL 렌더러
  "renderer_webgpu.js" // WebGPU 렌더러
);

// 상태 UI. 메시지는 애니메이션 프레임마다 배치됩니다.
let pendingStatus = null;

// 상태를 설정하는 함수
function setStatus(type, message) {
  if (pendingStatus) {
    // 상태가 이미 존재하면 해당 타입에 메시지를 추가
    pendingStatus[type] = message;
  } else {
    // 상태가 없으면 새로 생성하고 애니메이션 프레임을 요청
    pendingStatus = { [type]: message };
    self.requestAnimationFrame(statusAnimationFrame);
  }
}

// 애니메이션 프레임에서 상태를 전달하는 함수
function statusAnimationFrame() {
  // 상태를 메인 스레드로 전달
  self.postMessage(pendingStatus);

  // 상태 초기화
  pendingStatus = null;
}

// 렌더링 관련. 그리기는 애니메이션 프레임마다 한 번만 수행됩니다.
let renderer = null; // 렌더러 객체
let pendingFrame = null; // 대기 중인 비디오 프레임
let startTime = null; // 시작 시간
let frameCount = 0; // 프레임 카운트

let isPlaying = false; // 재생 여부

let lastRenderPTS = 0; // 마지막으로 렌더링한 PTS

function playFrame(param) {
  self.postMessage({ type: "playFrame" });
}

function renderFrame(frame) {
  const now = performance.now(); // 현재 시간

  if (!startTime) {
    startTime = now - frame.timestamp / 1000;
  }
  const elapsed = now - startTime; // 경과 시간(ms)
  const frameTime = frame.timestamp / 1000; // PTS 기반 재생 시간

  const delay = frameTime - elapsed; // 현재 시간과 프레임 타이밍 차이

  if (delay > 0) {
    // 아직 렌더링할 시간이 안 됐으면 delay 만큼 대기 후 렌더링
    frame.caption = `PTS: ${parseInt(frame.timestamp / 1_000_000)}초`;

    setTimeout(() => {
      requestAnimationFrame(() => {
        renderer.draw(frame);
        frame.close();
      });
    }, delay);
  } else {
    // 이미 늦었으면 바로 렌더링 (프레임 드롭 방지)
    requestAnimationFrame(() => {
      renderer.draw(frame);
      frame.close();
    });
  }

  lastRenderPTS = frame.timestamp;
}

// 비디오 프레임을 렌더링하는 함수
// function renderFrame(frame) {
//   if (!pendingFrame) {
//     // 프레임이 없으면 다음 애니메이션 프레임에서 렌더링 예약
//     requestAnimationFrame(renderAnimationFrame);
//   } else {
//     // 기존 대기 중인 프레임을 종료
//     pendingFrame.close();
//   }
//   // 새로 도착한 프레임을 대기 중인 프레임으로 설정
//   pendingFrame = frame;
// }

// 애니메이션 프레임에서 렌더링을 수행하는 함수
function renderAnimationFrame() {
  renderer.draw(pendingFrame); // 렌더러를 사용하여 프레임을 그립니다.
  pendingFrame = null; // 렌더링 후 대기 중인 프레임 초기화
}

// 시작 함수
function start({ dataUri, rendererName, canvas }) {
  console.log("Starting", rendererName, "renderer");
  console.log("Data URI length:", dataUri);
  console.log("rendererName:", rendererName);
  console.log("canvas:", canvas);

  // 렌더러를 선택하여 초기화
  switch (rendererName) {
    case "2d":
      renderer = new Canvas2DRenderer(canvas); // 2D 렌더러
      break;
    case "webgl":
      renderer = new WebGLRenderer(rendererName, canvas); // WebGL 렌더러
      break;
    case "webgl2":
      renderer = new WebGLRenderer(rendererName, canvas); // WebGL 2 렌더러
      break;
    case "webgpu":
      renderer = new WebGPURenderer(canvas); // WebGPU 렌더러
      break;
  }

  // VideoDecoder 설정
  const decoder = new VideoDecoder({
    // 비디오 프레임 디코딩 성공 시 호출되는 콜백 함수
    output(frame) {
      // 디코딩된 프레임을 처리하고 FPS를 업데이트
      if (startTime == null) {
        startTime = performance.now(); // 첫 번째 프레임의 시간 기록
      } else {
        const elapsed = (performance.now() - startTime) / 1000; // 경과 시간 (초)
        const fps = ++frameCount / elapsed; // FPS 계산
        setStatus("render", `${fps.toFixed(0)} fps`); // FPS 상태 업데이트
        // console.log("fps-->", fps);
      }
      // 프레임을 렌더링 대기열에 추가
      renderFrame(frame);
    },
    // 디코딩 오류 발생 시 호출되는 콜백 함수
    error(e) {
      setStatus("decode", e); // 오류 메시지 상태로 전달
    },
  });

  // MP4 파일을 디멀티플렉싱(분리)하는 데 사용될 Demuxer 설정
  const demuxer = new MP4Demuxer(dataUri, {
    // 비디오 구성 정보가 제공되었을 때 호출되는 콜백
    onConfig(config) {
      setStatus(
        "decode",
        `${config.codec} @ ${config.codedWidth}x${config.codedHeight}`
      );
      decoder.configure(config); // 디코더에 비디오 구성 정보 전달
    },
    // 비디오 데이터 조각이 제공되었을 때 호출되는 콜백
    onChunk(chunk) {
      console.log("chunk-->", chunk);
      decoder.decode(chunk); // 디코딩을 위해 비디오 조각을 전달
    },
    setStatus, // 상태 업데이트 함수 전달
  });
}

// 메인 스레드로부터의 메시지를 받아서 시작하는 리스너
self.addEventListener(
  "message",
  (message) => {
    // const message = message.data;
    const { type, ...data } = message.data;

    if (type === "start") start(data);
    else if (type === "play") playFrame();
    else if (type === "pause") console.log("pause");
  },
  {
    once: true, // 한번만 실행되도록 설정
  }
);
