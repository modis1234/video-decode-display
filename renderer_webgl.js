class WebGLRenderer {
  #canvas = null;
  #ctx = null;
  #mainTexture = null;
  #textCanvas = null;
  #textTexture = null;
  #trackData = null;

  static vertexShaderSource = `
    attribute vec2 xy;

    varying highp vec2 uv;

    void main(void) {
      gl_Position = vec4(xy, 0.0, 1.0);
      // Map vertex coordinates (-1 to +1) to UV coordinates (0 to 1).
      // UV coordinates are Y-flipped relative to vertex coordinates.
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

  constructor(type, canvas, textCanvas) {
    this.#canvas = canvas;
    this.#textCanvas = textCanvas;
    const gl = (this.#ctx = canvas.getContext(type));

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

  #updateTextTexture(frame) {
    const gl = this.#ctx;
    const ctx = this.#textCanvas.getContext("2d");

    const _filterData =
      this.#trackData?.filter(
        (item) => item.timestamp === frame.timestamp / 1_000_000
      ) || [];

    // ref: 0.7817708333333333,0.7462962962962963,0.8083333333333333,0.7944444444444444
    // x1: 0.7817708333333333, y1: 0.7462962962962963
    // x2: 0.8083333333333333, y2: 0.7944444444444444

    if (_filterData.length !== 0) {
      // return;

      _filterData.forEach((item) => {
        const axisX1 = this.#textCanvas.width * item.x1;
        const axisY1 = this.#textCanvas.height * item.y1;
        const axisX2 = this.#textCanvas.width * item.x2;
        const axisY2 = this.#textCanvas.height * item.y2;

        const _width = axisX2 - axisX1;
        const _height = axisY2 - axisY1;

        // 1. 캔버스 초기화
        // ctx.clearRect(0, 0, w, h);
        // ctx.clearRect(0, 0, this.#textCanvas.width, this.#textCanvas.height);
        // ctx.clearRect(0, 0, this.#textCanvas.width, this.#textCanvas.height);

        // 2. 사각형 그리기 (테두리만)
        let _color = "red";
        if (item.type === 1) {
          _color = "blue";
        } else if (item.type === 2) {
          _color = "green";
        } else if (item.type === 3) {
          _color = "yellow";
        } else if (item.type === 4) {
          _color = "purple";
        }

        ctx.strokeStyle = _color;
        ctx.lineWidth = 2;

        ctx.strokeRect(axisX1, axisY1, _width, _height);
      });
    }

    // 3. 텍스트 설정 및 출력
    const caption = frame.caption || "";

    ctx.font = "30px Arial bold";
    ctx.fillStyle = "red";
    ctx.border = "1px solid red";
    // ctx.textBaseline = "top";
    ctx.fillText(caption, 5, 25);

    // 4. WebGL 텍스처에 업로드
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
    const gl = this.#ctx;

    // this.#canvas.width = 800;
    // this.#canvas.height = 500;

    this.#canvas.width = frame.displayWidth;
    this.#canvas.height = frame.displayHeight;

    // 1. Upload video frame to main texture
    gl.bindTexture(gl.TEXTURE_2D, this.#mainTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    frame.close();

    // 2. Upload text to text texture

    this.#textCanvas
      .getContext("2d")
      .clearRect(0, 0, this.#textCanvas.width, this.#textCanvas.height);

    // console.log("frame->", frame);

    const caption = frame.caption || "";
    // _filterData.forEach((item) => {
    //   this.#updateTextTexture({
    //     x1: item.x1,
    //     y1: item.y1,
    //     x2: item.x2,
    //     y2: item.y2,
    //     text: caption,
    //   });
    // });
    this.#updateTextTexture(frame);

    // 3. Prepare viewport
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 4. Draw video frame
    gl.bindTexture(gl.TEXTURE_2D, this.#mainTexture); // ⬅️ 프레임 텍스처로 다시 바인딩
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    // 5. Enable blending and draw text
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindTexture(gl.TEXTURE_2D, this.#textTexture);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    gl.disable(gl.BLEND);
    frame.close();
  }

  setTrackData(trackData) {
    this.#trackData = trackData;
    // console.log("trackData->", this.#trackData);
  }
}
