class Canvas2DRenderer {
  #canvas = null;
  #ctx = null;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d");
  }

  draw(frame) {
    // this.#canvas.width = frame.displayWidth;
    // this.#canvas.height = frame.displayHeight;

    // this.#ctx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);

    const targetWidth = 800; // 원하는 가로 크기
    const targetHeight =
      (targetWidth * frame.displayHeight) / frame.displayWidth; // 비율 유지 (450px)

    // 캔버스 크기 설정
    this.#canvas.width = targetWidth;
    this.#canvas.height = targetHeight;

    this.#ctx.drawImage(frame, 0, 0, targetWidth, targetHeight);

    // 캡션 추가
    this.#ctx.font = "24px Arial bold";
    this.#ctx.fillStyle = "white";
    this.#ctx.fontWeight = "bold";

    this.#ctx.fillText(frame.caption, 10, 30); // ✅ 변수 사용

    // 캡션 추가
    this.#ctx.font = "24px Arial";
    this.#ctx.fillStyle = "white";
    this.#ctx.fontWeight = "bold";

    this.#ctx.fillText(`x${frame.playbackSpeed}`, 750, 30); // ✅ 변수 사용

    frame.close();
  }
}
