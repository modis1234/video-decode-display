class WebGLRenderer {
  #canvas = null;
  #ctx = null;
  #mainTexture = null;
  #textCanvas = null;
  #textTexture = null;
  #trackData = null;
  #mosaicCanvas = null; // ◆️ (1) Mosaic preprocessing canvas
  #selectedItem = null; // 선택된 객체를 저장하는 변수
  #selectedItemIndexs = []; // 선택된 객체의 인덱스를 저장하는 배열
  #lastFrame = 0; // ◆️ 마지막 프레임 저장
  #isDragging = false; // 드래그 상태를 나타내는 변수

  /**DrawGBox */
  #startPosX = null; // 드래그 시작 위치
  #startPosY = null; // 드래그 시작 위치
  #endPosX = null; // 드래그 끝 위치
  #endPosY = null; // 드래그 끝 위치
  #drawGBoxEnabled = false; // ← 드래그 박스 표시 여부 (드래그 완료 후에도 true 유지)

  #zoneList = []; // 드래그 박스 리스트 (여러 개의 드래그 박스를 저장하기 위한 배열)

  static vertexShaderSource = `
    attribute vec2 xy;
    varying highp vec2 uv;
    void main(void) {
      gl_Position = vec4(xy, 0.0, 1.0);
      uv = vec2((1.0 + xy.x) / 2.0, (1.0 - xy.y) / 2.0);
    }
  `;

  static fragmentShaderSource = `
    varying highp vec2 uv;
    uniform sampler2D texture;
    void main(void) {
      gl_FragColor = texture2D(texture, uv);
    }
  `;

  constructor(type, canvas, textCanvas, mosaicCanvas) {
    this.#canvas = canvas;
    this.#textCanvas = textCanvas;
    this.#mosaicCanvas = mosaicCanvas; // ◆️ (2) For pre-drawing with mosaic
    const gl = (this.#ctx = canvas.getContext(type));

    console.log("this.#textCanvas->", this.#textCanvas);

    // ▼ Shader compile setup
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, WebGLRenderer.vertexShaderSource);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      throw gl.getShaderInfoLog(vertexShader);
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, WebGLRenderer.fragmentShaderSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      throw gl.getShaderInfoLog(fragmentShader);
    }

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      throw gl.getProgramInfoLog(shaderProgram);
    }
    gl.useProgram(shaderProgram);

    // Vertex coordinates, clockwise from bottom-left.
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1.0, -1.0, -1.0, +1.0, +1.0, +1.0, +1.0, -1.0]),
      gl.STATIC_DRAW
    );

    const xyLocation = gl.getAttribLocation(shaderProgram, "xy");
    gl.vertexAttribPointer(xyLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(xyLocation);

    // Create one texture to upload frames to.
    this.#mainTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.#mainTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.#textTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.#textTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  getCanvas() {
    return this.#canvas;
  }
  // ◆️ Mosaic 처리 함수 (Canvas 2D)
  #applyMosaic(ctx, x, y, width, height, pixelSize) {
    const mosaicW = Math.max(1, Math.floor(width / pixelSize));
    const mosaicH = Math.max(1, Math.floor(height / pixelSize));

    const tempCanvas = new OffscreenCanvas(mosaicW, mosaicH);
    const tempCtx = tempCanvas.getContext("2d");

    // 1. 축소 (저해상도 캔버스에 draw)
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(ctx.canvas, x, y, width, height, 0, 0, mosaicW, mosaicH);

    // 2. 확대 (mosaic처럼 보이도록 다시 원래 ctx에 draw)
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(x, y, width, height);
    ctx.drawImage(tempCanvas, 0, 0, mosaicW, mosaicH, x, y, width, height);
  }

  #updateTextTexture(frame) {
    const gl = this.#ctx;
    const ctx = this.#textCanvas.getContext("2d");

    const _filterData =
      this.#trackData?.filter(
        (item) => item.timestamp === frame.timestamp / 1_000_000
      ) || [];

    if (_filterData.length !== 0) {
      _filterData.forEach((item) => {
        const axisX1 = this.#textCanvas.width * item.x1;
        const axisY1 = this.#textCanvas.height * item.y1;
        const axisX2 = this.#textCanvas.width * item.x2;
        const axisY2 = this.#textCanvas.height * item.y2;
        const _width = axisX2 - axisX1;
        const _height = axisY2 - axisY1;
        // ctx.fillStyle = "rgba(255, 0, 0, 0.3)"; // 배경 색 (반투명 빨강)
        // ctx.fillRect(axisX1, axisY1, _width, _height); // 배경 색 채우기
        let _color = "black"; // 기본 색상
        let _text = "Unknown";
        if (item.type === 1) {
          _color = "blue";
          // _text = "Person";
        } else if (item.type === 2) {
          _color = "green";
          _text = "person" + item.index;
        } else if (item.type === 3) {
          _color = "yellow";
          _text = "car" + item.index;
        } else if (item.type === 4) {
          _color = "purple";
        } else if (item.type === 0) {
          _color = "red";
          _text = "";
        }

        ctx.font = "20px Arial bold";
        ctx.fillStyle = _color;
        ctx.fillText(_text, axisX1, axisY1 - 5);

        const _hasSelectedIndex =
          this.#selectedItemIndexs?.length !== 0 &&
          this.#selectedItemIndexs.includes(item?.index);

        // ◆️ 선택된 항목 점선 표시
        if (_hasSelectedIndex) {
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = _color;
          ctx.lineWidth = 3;
          ctx.strokeRect(axisX1, axisY1, _width, _height);
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = _color;
          ctx.lineWidth = 2;
          ctx.strokeRect(axisX1, axisY1, _width, _height);
        }
      });
    }

    // ◆️ 드래그 박스 시각화
    if (
      // this.#drawGBoxEnabled &&
      this.#startPosX !== null &&
      this.#endPosX !== null
    ) {
      const drawX = this.#startPosX;
      const drawY = this.#startPosY;
      const drawW = this.#endPosX - this.#startPosX;
      const drawH = this.#endPosY - this.#startPosY;
      ctx.font = "20px Arial bold";
      ctx.fillStyle = "blue";
      ctx.fillText("Object", drawX, drawY - 5);

      ctx.strokeStyle = "blue";
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(drawX, drawY, drawW, drawH);
      ctx.setLineDash([]);
    }

    // ◆️ 영역 박스 시각화
    if (this.#zoneList.length > 0) {
      this.#zoneList.forEach((zone) => {
        ctx.strokeStyle = "blue"; // 영역 박스 색상
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
        ctx.setLineDash([]);
      });
    }

    const caption = frame.caption || "PTS: 0초";
    ctx.font = "30px Arial bold";
    ctx.fillStyle = "red";
    ctx.fillText(caption, 5, 25);

    gl.bindTexture(gl.TEXTURE_2D, this.#textTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.#textCanvas
    );
  }

  draw(frame) {
    // ▲ drawImage 전에 frame 유효성 검사
    if (!frame || frame.displayWidth === 0 || frame.displayHeight === 0) {
      console.warn("Invalid frame, skipping draw.");
      return;
    }

    this.#lastFrame = frame; // ◆️ 마지막 프레임 저장

    // const width = frame.displayWidth;
    // const height = frame.displayHeight;

    const width = 1650;
    const height = 900;

    this.#canvas.width = width;
    this.#canvas.height = height;
    this.#mosaicCanvas.width = width;
    this.#mosaicCanvas.height = height;

    const preCtx = this.#mosaicCanvas.getContext("2d");

    // ① draw video frame to preprocessing canvas
    preCtx.drawImage(frame, 0, 0, width, height);

    // ② apply mosaic to each tracked region
    const _filterData =
      this.#trackData?.filter(
        (item) => item.timestamp === frame.timestamp / 1_000_000
      ) || [];

    _filterData.forEach((item) => {
      const x1 = width * item.x1;
      const y1 = height * item.y1;
      const x2 = width * item.x2;
      const y2 = height * item.y2;
      const w = x2 - x1;
      const h = y2 - y1;
      this.#applyMosaic(preCtx, x1, y1, w, h, 10); // ◆️ pixelSize = 10
    });

    const gl = this.#ctx;

    // ③ upload processed canvas to WebGL texture
    gl.bindTexture(gl.TEXTURE_2D, this.#mainTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.#mosaicCanvas
    );
    frame.close();

    // ④ text overlay
    this.#textCanvas
      .getContext("2d")
      .clearRect(0, 0, this.#textCanvas.width, this.#textCanvas.height);
    this.#updateTextTexture(frame);

    // ⑤ render
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 4. Draw video frame
    gl.bindTexture(gl.TEXTURE_2D, this.#mainTexture);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindTexture(gl.TEXTURE_2D, this.#textTexture);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    gl.disable(gl.BLEND);
    frame.close();
  }

  setTrackData(trackData) {
    this.#trackData = trackData;
  }
  clear() {
    this.#textCanvas
      .getContext("2d")
      .clearRect(0, 0, this.#textCanvas.width, this.#textCanvas.height);
  }
  redrawSelectedBox() {
    if (!this.#lastFrame || !this.#trackData) return;
    // Clear the text canvas before redrawing
    this.#textCanvas
      .getContext("2d")
      .clearRect(0, 0, this.#textCanvas.width, this.#textCanvas.height);

    this.#updateTextTexture(this.#lastFrame);

    const gl = this.#ctx;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindTexture(gl.TEXTURE_2D, this.#mainTexture);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, this.#textTexture);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.disable(gl.BLEND);
  }

  handleClick(x, y) {
    if (!this.#trackData) return;
    const width = this.#canvas.width;
    const height = this.#canvas.height;
    const target = this.#trackData.find((item) => {
      const x1 = item.x1 * width;
      const y1 = item.y1 * height;
      const x2 = item.x2 * width;
      const y2 = item.y2 * height;

      const _lastFrameTimestamp = this.#lastFrame.timestamp / 1_000_000 || 0;

      const _itemTimestamp = item.timestamp || 0;
      return (
        _lastFrameTimestamp === _itemTimestamp &&
        x >= x1 &&
        x <= x2 &&
        y >= y1 &&
        y <= y2
      );
    });

    this.#selectedItem = target || null;
    const _hasSelectedIndex = this.#selectedItemIndexs.includes(target?.index);
    if (_hasSelectedIndex) {
      this.#selectedItemIndexs = this.#selectedItemIndexs.filter(
        (index) => index !== target?.index
      );
    } else {
      this.#selectedItemIndexs.push(target?.index);
    }
  }
  handlePauseClick(x, y) {
    console.log("handlePauseClick-->", x, y);
    if (!this.#trackData) return;
    const width = this.#canvas.width;
    const height = this.#canvas.height;
    const target = this.#trackData.find((item) => {
      const x1 = item.x1 * width;
      const y1 = item.y1 * height;
      const x2 = item.x2 * width;
      const y2 = item.y2 * height;

      const _lastFrameTimestamp = this.#lastFrame.timestamp / 1_000_000 || 0;

      const _itemTimestamp = item.timestamp || 0;

      return (
        _lastFrameTimestamp === _itemTimestamp &&
        x >= x1 &&
        x <= x2 &&
        y >= y1 &&
        y <= y2
      );
    });

    this.#selectedItem = target || null;
    const _hasSelectedIndex = this.#selectedItemIndexs.includes(target?.index);
    if (_hasSelectedIndex) {
      this.#selectedItemIndexs = this.#selectedItemIndexs.filter(
        (index) => index !== target?.index
      );
    } else {
      this.#selectedItemIndexs.push(target?.index);
    }

    if (this.#startPosX !== null && this.#endPosX !== null) {
    } // 드래그 박스가 있을 때는 드래그 박스에 대한 클릭 이벤트를 무시

    this.redrawSelectedBox(); // ◆️ 정지 상태에서도 점선 박스 갱신
  }
  handleMouseMove(x, y) {
    if (!this.#trackData) return false;

    // x, y 좌표로 this.#selectedItem을 업데이트
    if (this.#isDragging && this.#selectedItem) {
      this.#selectedItem = {
        ...this.#selectedItem,
        customX: x,
        customY: y,
      };
    }

    const width = this.#textCanvas.width;
    const height = this.#textCanvas.height;

    if (this.#drawGBoxEnabled && this.#startPosX) {
      this.#endPosX = x; // 드래그 끝 위치 저장
      this.#endPosY = y; // 드래그 끝 위치 저장
      this.redrawSelectedBox(); // 드래그 중인 박스 그리기
    }

    // 드래그 중이 아닐 때만 hover 체크
    return this.#trackData.some((item) => {
      const x1 = item.x1 * width;
      const y1 = item.y1 * height;
      const x2 = item.x2 * width;
      const y2 = item.y2 * height;

      const _lastFrameTimestamp = this.#lastFrame.timestamp / 1_000_000 || 0;

      const _itemTimestamp = item.timestamp || 0;

      return (
        _lastFrameTimestamp === _itemTimestamp &&
        x >= x1 &&
        x <= x2 &&
        y >= y1 &&
        y <= y2
      );
    });
  }
  handleMouseDown(x, y) {
    this.#isDragging = true; // 드래그 시작

    const width = this.#textCanvas.width;
    const height = this.#textCanvas.height;
    const target = this.#trackData.find((item) => {
      const x1 = item.x1 * width;
      const y1 = item.y1 * height;
      const x2 = item.x2 * width;
      const y2 = item.y2 * height;

      const _lastFrameTimestamp = this.#lastFrame.timestamp / 1_000_000 || 0;

      const _itemTimestamp = item.timestamp || 0;

      return (
        _lastFrameTimestamp === _itemTimestamp &&
        x >= x1 &&
        x <= x2 &&
        y >= y1 &&
        y <= y2
      );
    });

    this.#selectedItem = target || null;

    if (!target) {
      // clearDrawGBox(); // 드래그 박스 초기화
      // mouse down 시점에 선택된 객체가 없을 때
      this.#drawGBoxEnabled = true; // 시작하면 그리기 허용
      this.#startPosX = x; // 드래그 시작 위치 저장
      this.#startPosY = y; // 드래그 시작 위치 저장
    }
  }
  handleMouseUp(x, y) {
    this.#isDragging = false;

    // 드래그 상태 초기화
    this.#drawGBoxEnabled = false;
    this.redrawSelectedBox();
  }

  clearDrawGBox() {
    this.#drawGBoxEnabled = false;
    this.#startPosX = null;
    this.#startPosY = null;
    this.#endPosX = null;
    this.#endPosY = null;
    this.redrawSelectedBox(); // 다시 그려서 박스 제거
  }
  zoneSetting() {
    console.log("zoneSetting-->");
    const _width = 500;
    const _height = 500;

    this.#zoneList.push({
      x: 100,
      y: 100,
      w: _width,
      h: _height,
    });
    console.log("this.#zoneList-->", this.#zoneList);
    this.redrawSelectedBox();
  }
}
